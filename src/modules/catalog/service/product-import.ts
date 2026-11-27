import "server-only";
import { db, transaction } from "@/lib/db";
import { slugify } from "@/lib/i18n/names";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit/service/audit";
import { backgroundAdminActor } from "@/modules/identity/service/admin-auth";
import { readPrivateFile, storePrivateFile } from "@/modules/media/service/private-files";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { checkRow, IMPORT_LIMITS, importSlugKey, readImportFile, type ImportCells, type ImportLookups } from "../domain/product-import";
import { skuSchema } from "../domain/catalog-input";
import { getProductDetail } from "../repo/catalog-repo";
import {
  cancelJobRow,
  claimJobToValidate,
  confirmJobRow,
  failJob,
  finishJobRow,
  getImportJob,
  importRowsWithStatus,
  insertImportJob,
  listImportJobs,
  nextJobToApply,
  productIdentifierKeys,
  saveValidation,
  setRowResult,
  slugIds,
  variantsBySku,
  type CheckedImportRow,
} from "../repo/import-repo";
import { IS_UUID } from "./catalog-access";
import { addIdentifier, changePrice, createProduct, setProductStatus, updateProduct, type ProductResult } from "./products";

/**
 * Product import from a CSV file (import.run, Business and Super Admin).
 *
 * 1. Upload: the file is kept as a private file and a job is created. Nothing
 *    is read during the request.
 * 2. Check (background job): every row is checked against the catalog and
 *    the dry-run report lists what would be created, updated or refused.
 *    Nothing in the catalog changes.
 * 3. Confirm: the admin confirms the report; the background job then applies
 *    the valid rows in order through the ordinary product services, acting as
 *    the admin who confirmed (with their permissions at that moment), so
 *    every change is authorized and audited like one made by hand.
 *
 * A row's outcome is recorded once it is applied, so a run that stops
 * half-way carries on where it left off.
 */

export type ImportResult = { status: "ok"; id: string } | { status: "invalid"; field: string } | { status: "not_found" } | { status: "not_allowed" };

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("import.run", "not_admin");
  await authorize(actor, "import.run");
  return actor.userId;
}

const CSV_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream", ""]);

export async function uploadProductImport(actor: Actor, file: { name: string; type: string; bytes: Uint8Array }, now = new Date()): Promise<ImportResult> {
  const userId = await allow(actor);
  if (file.bytes.length === 0) return { status: "invalid", field: "file_missing" };
  if (file.bytes.length > IMPORT_LIMITS.bytes) return { status: "invalid", field: "file_too_large" };
  if (!/\.csv$/i.test(file.name) || !CSV_TYPES.has(file.type)) return { status: "invalid", field: "not_csv" };
  const name = file.name.slice(0, 200);
  const fileMediaId = await storePrivateFile({ userId, name, mimeType: "text/csv", bytes: file.bytes }, now);
  const id = await transaction(async (tx) => {
    const id = await insertImportJob(tx, { fileMediaId, originalName: name, createdById: userId });
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "import.uploaded", entityType: "data_import_job", entityId: id, after: { type: "products", name, bytes: file.bytes.length } });
    return id;
  });
  return { status: "ok", id };
}

export async function listProductImports(actor: Actor) {
  await allow(actor);
  return listImportJobs(db());
}

/** A job with the rows a person needs to look at: refused rows, then rows that failed when applied. */
export async function getProductImport(actor: Actor, id: string) {
  await allow(actor);
  if (!IS_UUID.test(id)) return null;
  const job = await getImportJob(db(), id);
  if (!job) return null;
  const [problems, done] = await Promise.all([
    importRowsWithStatus(db(), id, ["invalid", "failed"], 500),
    importRowsWithStatus(db(), id, ["created", "updated"], 200),
  ]);
  const view = (r: (typeof problems)[number]) => ({
    rowNumber: r.rowNumber,
    status: r.status,
    sku: String((r.data as { sku?: unknown } | null)?.sku ?? ""),
    errors: Array.isArray(r.errors) ? (r.errors as string[]) : [],
    productId: r.entityId,
  });
  return { job, problems: problems.map(view), applied: done.map(view) };
}

export async function confirmProductImport(actor: Actor, id: string, now = new Date()): Promise<ImportResult> {
  const userId = await allow(actor);
  if (!IS_UUID.test(id)) return { status: "not_found" };
  const ok = await transaction(async (tx) => {
    if (!(await confirmJobRow(tx, id, userId, now))) return false;
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "import.confirmed", entityType: "data_import_job", entityId: id });
    return true;
  });
  return ok ? { status: "ok", id } : { status: "not_allowed" };
}

export async function cancelProductImport(actor: Actor, id: string, now = new Date()): Promise<ImportResult> {
  const userId = await allow(actor);
  if (!IS_UUID.test(id)) return { status: "not_found" };
  const ok = await transaction(async (tx) => {
    if (!(await cancelJobRow(tx, id, now))) return false;
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "import.cancelled", entityType: "data_import_job", entityId: id });
    return true;
  });
  return ok ? { status: "ok", id } : { status: "not_allowed" };
}

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------

async function lookups(skus: readonly string[]): Promise<ImportLookups> {
  const [unit, slugs, variants] = await Promise.all([getDisplayUnit(), slugIds(db()), variantsBySku(db(), skus)]);
  return {
    unit,
    categoryBySlug: new Map(slugs.categories.map((c) => [importSlugKey(c.slug), c.id])),
    brandBySlug: new Map(slugs.brands.map((b) => [importSlugKey(b.slug), b.id])),
    existingSku: new Map(variants.map((v) => [v.skuNormalized, { productId: v.productId, isDefault: v.isDefault }])),
  };
}

/** SKUs of the rows in lookup form (rows with an unusable SKU are left out; checkRow refuses them). */
const skuKeys = (rows: readonly { cells: ImportCells }[]) =>
  rows.flatMap((r) => {
    const sku = skuSchema.safeParse(r.cells.sku);
    return sku.success ? [sku.data.skuNormalized] : [];
  });

/** Checks one uploaded file and writes the dry-run report. */
async function validateJob(job: { id: string; fileMediaId: string }, now: Date): Promise<void> {
  const bytes = await readPrivateFile(job.fileMediaId);
  if (!bytes) return failJob(db(), job.id, "validating", { error: "file_missing" }, now);
  const file = readImportFile(bytes);
  if ("error" in file) return failJob(db(), job.id, "validating", { error: file.error, detail: file.detail ?? null }, now);
  const look = await lookups([...new Set(skuKeys(file.rows))]);
  const seen = new Set<string>();
  const report = { create: 0, update: 0, invalid: 0 };
  const rows: CheckedImportRow[] = file.rows.map(({ rowNumber, cells }) => {
    const checked = checkRow(cells, look, seen);
    if ("errors" in checked) {
      report.invalid++;
      return { rowNumber, status: "invalid", data: cells, errors: checked.errors };
    }
    report[checked.row.action]++;
    return { rowNumber, status: "valid", data: { ...cells, action: checked.row.action }, errors: null };
  });
  await transaction((tx) => saveValidation(tx, job.id, rows, report));
}

function failure(result: ProductResult | { status: string; field?: string }): string {
  return "field" in result && result.field ? result.field : result.status;
}

/**
 * Applies one checked row through the product services. The row is checked
 * again first: the catalog may have changed since the dry run.
 */
async function applyRow(actor: Actor, cells: ImportCells, look: ImportLookups): Promise<{ status: "created" | "updated" | "failed"; entityId: string | null; errors: string[] | null }> {
  const checked = checkRow(cells, look, new Set());
  if ("errors" in checked) return { status: "failed", entityId: null, errors: checked.errors };
  const row = checked.row;
  const notes: string[] = [];
  let productId: string;

  if (row.action === "create") {
    const input = {
      faTitle: cells.title_fa,
      faSlug: "",
      faShort: cells.short_fa,
      enTitle: cells.title_en,
      enSlug: "",
      enShort: cells.short_en,
      brandId: row.brandId ?? "",
      primaryCategoryId: row.categoryId,
      categoryIds: [] as string[],
      warrantyMonths: cells.warranty_months,
      sku: cells.sku,
      price: cells.price,
      compareAtPrice: cells.compare_at_price,
    };
    let created = await createProduct(actor, input);
    if (created.status === "taken" && created.field === "slug") {
      // Two products with the same title: the SKU tells their addresses apart.
      const suffix = slugify(row.sku);
      created = await createProduct(actor, {
        ...input,
        faSlug: `${slugify(cells.title_fa).slice(0, 120)}-${suffix}`,
        enSlug: cells.title_en ? `${slugify(cells.title_en).slice(0, 120)}-${suffix}` : "",
      });
    }
    if (created.status !== "ok") return { status: "failed", entityId: null, errors: [failure(created)] };
    if (created.priceStatus === "proposed") notes.push("price_proposed");
    productId = created.id;
  } else {
    productId = row.productId!;
    const current = await getProductDetail(db(), productId);
    if (!current) return { status: "failed", entityId: null, errors: ["not_found"] };
    const fa = current.translations.find((t) => t.locale === "fa");
    const en = current.translations.find((t) => t.locale === "en");
    const enTitle = cells.title_en || en?.title || "";
    const updated = await updateProduct(actor, productId, {
      faTitle: cells.title_fa,
      faSlug: fa?.slug ?? "",
      faShort: cells.short_fa || fa?.shortDescription || "",
      enTitle,
      enSlug: en?.slug ?? "",
      enShort: enTitle ? cells.short_en || en?.shortDescription || "" : "",
      brandId: row.brandId ?? current.brandId ?? "",
      primaryCategoryId: row.categoryId,
      // Extra categories the product is in stay; the file names the main one.
      categoryIds: current.categories.map((c) => c.categoryId),
      warrantyMonths: cells.warranty_months || (current.warrantyMonths?.toString() ?? ""),
    });
    if (updated.status !== "ok") return { status: "failed", entityId: productId, errors: [failure(updated)] };
    const main = current.variants.find((v) => v.isDefault);
    if (cells.price !== "" && main) {
      const price = await changePrice(actor, main.id, { price: cells.price, compareAtPrice: cells.compare_at_price });
      if (price.status === "proposed") notes.push("price_proposed");
      else if (price.status === "pending_exists") notes.push("price_pending");
      else if (price.status !== "applied" && price.status !== "unchanged") notes.push(failure(price));
    }
  }

  if (row.partNumbers.length > 0) {
    const have = await productIdentifierKeys(db(), productId);
    for (const part of row.partNumbers) {
      if (have.has(part.normalizedValue)) continue;
      const added = await addIdentifier(actor, productId, { type: "oem", value: part.value, brandId: "" });
      if (added.status !== "ok") notes.push("part_number_not_added");
    }
  }

  if (row.status) {
    const status = await setProductStatus(actor, productId, row.status);
    if (status.status === "not_publishable") notes.push("not_publishable");
    else if (status.status !== "ok") notes.push(failure(status));
  }
  return { status: row.action === "create" ? "created" : "updated", entityId: productId, errors: notes.length > 0 ? [...new Set(notes)] : null };
}

const BATCH = 100;

/** Applies a confirmed job's rows until the deadline; the next run carries on. */
async function applyJob(job: { id: string; confirmedById: string | null }, deadline: number, now: () => Date): Promise<number> {
  const requestId = `import-${job.id}`;
  const actor = job.confirmedById ? await backgroundAdminActor(job.confirmedById, requestId, now()) : null;
  const allowed = actor !== null && actor.permissions.has("import.run");
  if (!allowed) {
    await failJob(db(), job.id, "applying", { error: "confirmer_not_allowed" }, now());
    return 0;
  }
  let applied = 0;
  while (Date.now() < deadline) {
    const rows = await importRowsWithStatus(db(), job.id, ["valid"], BATCH);
    if (rows.length === 0) {
      const result = await finishJobRow(db(), job.id, now());
      await recordAudit(db(), actor.meta, { actorUserId: actor.userId, action: "import.completed", entityType: "data_import_job", entityId: job.id, after: result });
      return applied;
    }
    const cellsOf = rows.map((r) => ({ id: r.id, cells: r.data as unknown as ImportCells }));
    const look = await lookups([...new Set(skuKeys(cellsOf))]);
    for (const row of cellsOf) {
      if (Date.now() >= deadline) break;
      let result: Awaited<ReturnType<typeof applyRow>>;
      try {
        result = await applyRow(actor, row.cells, look);
      } catch (error) {
        if (error instanceof AuthzError) {
          // The confirming admin lost a permission the row needs; the row is
          // refused, the rest carry on (they may need other permissions).
          result = { status: "failed", entityId: null, errors: ["forbidden"] };
        } else {
          logger.error("import row failed", { job: job.id, error: String(error) });
          result = { status: "failed", entityId: null, errors: ["unexpected"] };
        }
      }
      await setRowResult(db(), row.id, result);
      if (result.status !== "failed") applied++;
      // An SKU created by this row is now in the catalog; later rows see it.
      if (result.status === "created" && result.entityId) {
        const key = skuKeys([row])[0]!;
        (look.existingSku as Map<string, { productId: string; isDefault: boolean }>).set(key, { productId: result.entityId, isDefault: true });
      }
    }
  }
  return applied;
}

/**
 * The background job ("imports-process"): checks uploaded files, then
 * applies confirmed ones, for at most `budgetMs`. Runs one at a time (the
 * queue is stately), so a row is never applied by two runs together.
 */
export async function processProductImports(budgetMs = 50_000, now: () => Date = () => new Date()): Promise<{ validated: number; applied: number }> {
  const deadline = Date.now() + budgetMs;
  let validated = 0;
  let applied = 0;
  while (Date.now() < deadline) {
    const job = await claimJobToValidate(db(), now());
    if (!job) break;
    try {
      await validateJob(job, now());
    } catch (error) {
      logger.error("import check failed", { job: job.id, error: String(error) });
      await failJob(db(), job.id, "validating", { error: "unexpected" }, now());
    }
    validated++;
  }
  while (Date.now() < deadline) {
    const job = await nextJobToApply(db());
    if (!job) break;
    applied += await applyJob(job, deadline, now);
  }
  return { validated, applied };
}
