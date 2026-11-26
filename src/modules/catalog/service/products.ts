import "server-only";
import { db, transaction } from "@/lib/db";
import type { Rial } from "@/lib/money";
import { normalizeForSearch, normalizeIdentifier } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import { getApprovalTtlHours, getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import {
  firstIssue,
  identifierInputSchema,
  parsePriceChange,
  PRODUCT_STATUSES,
  productDetailsSchema,
  publishProblems,
  skuSchema,
  variantDetailsSchema,
  type IdentifierInput,
  type PriceChange,
  type ProductDetailsInput,
  type ProductStatusKey,
  type VariantDetailsInput,
} from "../domain/catalog-input";
import {
  databaseMessage,
  deleteIdentifierRow,
  getBrand,
  getCategory,
  getProductDetail,
  getVariant,
  insertIdentifier,
  insertPriceApproval,
  insertProduct,
  insertVariant,
  isUniqueViolation,
  listProducts,
  pendingApprovalFor,
  priceHistory,
  productCategoryIds,
  setProductStatusRow,
  setTransactionActor,
  setVariantCostRow,
  setVariantPriceRow,
  updateProductRow,
  updateVariantRow,
  type PricePayload,
} from "../repo/catalog-repo";
import { adminId, allowedCategories, allows, IS_UUID } from "./catalog-access";

/**
 * Products, variants, prices and part numbers (Phase 6).
 *
 * - product.view / create / update: Store Staff hold them for their
 *   categories; a product is in scope only when all its categories are.
 * - price.update (Business and Super Admin) changes a price directly;
 *   price.update.propose (Store Staff) files a request that runs only after
 *   someone holding price.update approves it (see price-approvals.ts).
 * - product.archive (Business and Super Admin) archives and restores.
 * - Cost prices are shown only with accounting.view or report.financial.
 * Every price change is recorded in product_prices by a database trigger with
 * the acting user (and the approval, when there was one).
 */

export type ProductResult =
  | { status: "ok"; id: string }
  | { status: "invalid"; field: string }
  | { status: "not_found" }
  | { status: "taken"; field: "slug" | "sku" | "identifier" }
  | { status: "not_publishable"; problems: string[] };

export type PriceResult =
  | { status: "applied" }
  | { status: "proposed"; approvalId: string }
  | { status: "invalid"; field: string }
  | { status: "not_found" }
  | { status: "unchanged" }
  | { status: "pending_exists" };

const COST_VIEW = ["accounting.view", "report.financial"] as const;
const canSeeCost = (actor: Actor) => COST_VIEW.some((k) => actor.permissions.has(k));

function takenField(error: unknown): ProductResult | null {
  if (!isUniqueViolation(error)) return null;
  const text = databaseMessage(error);
  if (text.includes("sku")) return { status: "taken", field: "sku" };
  if (text.includes("identifier") || text.includes("normalized_value")) return { status: "taken", field: "identifier" };
  return { status: "taken", field: "slug" };
}

async function loadScope(actor: Actor, productId: string, permission: string, stepUp = true): Promise<string[] | null> {
  if (!IS_UUID.test(productId)) return null;
  const categoryIds = await productCategoryIds(db(), productId);
  if (!categoryIds) return null;
  await authorize(actor, permission, { type: "product", id: productId, categoryIds }, { stepUp });
  return categoryIds;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProductsForAdmin(actor: Actor, query: { q?: string; status?: string; categoryId?: string; page?: string | number }) {
  const allowed = await allowedCategories(actor, "product.view");
  const q = (query.q ?? "").slice(0, 100);
  const status = PRODUCT_STATUSES.includes(query.status as ProductStatusKey) ? (query.status as ProductStatusKey) : null;
  const categoryId = query.categoryId && IS_UUID.test(query.categoryId) ? query.categoryId : null;
  const pageNumber = Number(query.page);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 1000 ? pageNumber : 1;
  const result = await listProducts(db(), {
    search: q ? normalizeForSearch(q) : null,
    skuSearch: q ? normalizeIdentifier(q) || null : null,
    status,
    categoryId,
    allowedCategoryIds: allowed,
    page,
  });
  return { ...result, page, canCreate: actor.permissions.has("product.create") };
}

export async function getProductForAdmin(actor: Actor, productId: string) {
  const categoryIds = await loadScope(actor, productId, "product.view", false);
  if (!categoryIds) return null;
  const product = await getProductDetail(db(), productId);
  if (!product) return null;
  const now = new Date();
  const showCost = canSeeCost(actor);
  const variants = await Promise.all(
    product.variants.map(async (v) => ({
      ...v,
      costPrice: showCost ? v.costPrice : null,
      history: await priceHistory(db(), v.id, 10),
      pendingApproval: await pendingApprovalFor(db(), v.id, now),
    })),
  );
  return {
    product: { ...product, variants },
    unit: await getDisplayUnit(),
    can: {
      edit: allows(actor, "product.update", categoryIds),
      setPrice: allows(actor, "price.update", categoryIds),
      proposePrice: allows(actor, "price.update.propose", categoryIds),
      archive: allows(actor, "product.archive", categoryIds),
      seeCost: showCost,
      editCost: showCost && allows(actor, "price.update", categoryIds),
    },
    publishProblems: publishProblems(product),
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

async function validateReferences(details: { brandId: string | null; categoryIds: string[] }): Promise<string | null> {
  if (details.brandId && !(await getBrand(db(), details.brandId))) return "invalid_brand";
  for (const id of details.categoryIds) if (!(await getCategory(db(), id))) return "invalid_category";
  return null;
}

/**
 * Creates a draft product with its main variant. The price is set directly
 * when the actor holds price.update for these categories; with
 * price.update.propose the product starts unpriced and a price request is
 * filed for approval in the same transaction.
 */
export async function createProduct(
  actor: Actor,
  input: ProductDetailsInput & { sku: string; price: string; compareAtPrice: string },
): Promise<ProductResult & { priceStatus?: "applied" | "proposed" | "none" }> {
  const userId = adminId(actor, "product.create");
  const parsed = productDetailsSchema.safeParse(input);
  if (!parsed.success) {
    await allowedCategories(actor, "product.create");
    return { status: "invalid", field: firstIssue(parsed.error) };
  }
  const details = parsed.data;
  await authorize(actor, "product.create", { type: "product", categoryIds: details.categoryIds });
  const reference = await validateReferences(details);
  if (reference) return { status: "invalid", field: reference };
  const sku = skuSchema.safeParse(input.sku);
  if (!sku.success) return { status: "invalid", field: firstIssue(sku.error) };

  let price: PriceChange | null = null;
  if (input.price.trim() !== "" || input.compareAtPrice.trim() !== "") {
    const parsedPrice = parsePriceChange(input, await getDisplayUnit());
    if ("error" in parsedPrice) return { status: "invalid", field: parsedPrice.error };
    price = parsedPrice;
  }
  const direct = price !== null && allows(actor, "price.update", details.categoryIds);
  if (price && !direct) await authorize(actor, "price.update.propose", { type: "product", categoryIds: details.categoryIds });
  const ttlHours = price && !direct ? await getApprovalTtlHours() : 0;

  try {
    const ids = await transaction(async (tx) => {
      await setTransactionActor(tx, userId);
      const ids = await insertProduct(tx, {
        details,
        sku: sku.data,
        price: direct && price ? price.price : 0n,
        compareAtPrice: direct && price ? price.compareAtPrice : null,
        actorId: userId,
      });
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "product.created",
        entityType: "product",
        entityId: ids.productId,
        after: {
          titles: Object.fromEntries(details.texts.map((t) => [t.locale, t.title])),
          sku: sku.data.sku,
          categoryIds: details.categoryIds,
          brandId: details.brandId,
          price: direct && price ? price.price.toString() : null,
        },
      });
      if (price && !direct) {
        const payload: PricePayload = {
          variantId: ids.variantId,
          productId: ids.productId,
          price: price.price.toString(),
          compareAtPrice: price.compareAtPrice?.toString() ?? null,
          previousPrice: "0",
          previousCompareAtPrice: null,
        };
        const approvalId = await insertPriceApproval(tx, { payload, requestedById: userId, expiresAt: new Date(Date.now() + ttlHours * 3_600_000) });
        await recordAudit(tx, actor.meta, { actorUserId: userId, action: "price.proposed", entityType: "product_variant", entityId: ids.variantId, after: { ...payload, approvalId } });
      }
      return ids;
    });
    return { status: "ok", id: ids.productId, priceStatus: price ? (direct ? "applied" : "proposed") : "none" };
  } catch (error) {
    const taken = takenField(error);
    if (taken) return taken;
    if (databaseMessage(error).includes("slug_format")) return { status: "invalid", field: "invalid_slug" };
    throw error;
  }
}

/** Edits titles, categories, brand and warranty. Moving to another category needs the permission there too. */
export async function updateProduct(actor: Actor, productId: string, input: ProductDetailsInput): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  const current = await loadScope(actor, productId, "product.update");
  if (!current) return { status: "not_found" };
  const parsed = productDetailsSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  const details = parsed.data;
  await authorize(actor, "product.update", { type: "product", id: productId, categoryIds: details.categoryIds });
  const reference = await validateReferences(details);
  if (reference) return { status: "invalid", field: reference };
  const before = await getProductDetail(db(), productId);
  try {
    await transaction(async (tx) => {
      await updateProductRow(tx, productId, details, userId);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "product.updated",
        entityType: "product",
        entityId: productId,
        before: before
          ? { titles: Object.fromEntries(before.translations.map((t) => [t.locale, t.title])), categoryIds: current, brandId: before.brandId, warrantyMonths: before.warrantyMonths }
          : null,
        after: { titles: Object.fromEntries(details.texts.map((t) => [t.locale, t.title])), categoryIds: details.categoryIds, brandId: details.brandId, warrantyMonths: details.warrantyMonths },
      });
    });
    return { status: "ok", id: productId };
  } catch (error) {
    const taken = takenField(error);
    if (taken) return taken;
    if (databaseMessage(error).includes("slug_format")) return { status: "invalid", field: "invalid_slug" };
    throw error;
  }
}

/**
 * Draft <-> active needs product.update; archiving or restoring an archived
 * product needs product.archive. Publishing needs an active, priced main variant.
 */
export async function setProductStatus(actor: Actor, productId: string, status: string, now = new Date()): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  if (!PRODUCT_STATUSES.includes(status as ProductStatusKey)) return { status: "invalid", field: "invalid_status" };
  const next = status as ProductStatusKey;
  const categoryIds = await loadScope(actor, productId, "product.update");
  if (!categoryIds) return { status: "not_found" };
  const product = await getProductDetail(db(), productId);
  if (!product) return { status: "not_found" };
  if (product.status === next) return { status: "ok", id: productId };
  if (next === "archived" || product.status === "archived") {
    await authorize(actor, "product.archive", { type: "product", id: productId, categoryIds });
  }
  if (next === "active") {
    const problems = publishProblems(product);
    if (problems.length > 0) return { status: "not_publishable", problems };
  }
  await transaction(async (tx) => {
    await setProductStatusRow(tx, productId, next, userId, now);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: next === "archived" ? "product.archived" : next === "active" ? "product.published" : "product.unpublished",
      entityType: "product",
      entityId: productId,
      before: { status: product.status },
      after: { status: next },
    });
  });
  return { status: "ok", id: productId };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Adds a variant (unpriced; set or propose its price next). */
export async function addVariant(actor: Actor, productId: string, input: VariantDetailsInput): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  if (!(await loadScope(actor, productId, "product.update"))) return { status: "not_found" };
  const parsed = variantDetailsSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  try {
    const id = await transaction(async (tx) => {
      await setTransactionActor(tx, userId);
      const id = await insertVariant(tx, productId, parsed.data);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "product.variant_created", entityType: "product_variant", entityId: id, after: { productId, sku: parsed.data.sku.sku } });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    const taken = takenField(error);
    if (taken) return taken;
    throw error;
  }
}

export async function updateVariant(actor: Actor, variantId: string, input: VariantDetailsInput): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  if (!IS_UUID.test(variantId)) return { status: "not_found" };
  const variant = await getVariant(db(), variantId);
  if (!variant || !(await loadScope(actor, variant.productId, "product.update"))) return { status: "not_found" };
  const parsed = variantDetailsSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  try {
    await transaction(async (tx) => {
      await updateVariantRow(tx, variantId, parsed.data);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "product.variant_updated",
        entityType: "product_variant",
        entityId: variantId,
        before: { sku: variant.sku, isActive: variant.isActive },
        after: { sku: parsed.data.sku.sku, isActive: parsed.data.isActive },
      });
    });
    return { status: "ok", id: variantId };
  } catch (error) {
    const taken = takenField(error);
    if (taken) return taken;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Changes a variant's price, typed in the store's display unit. Applied at
 * once with price.update; filed as a request with price.update.propose
 * (one open request per variant).
 */
export async function changePrice(actor: Actor, variantId: string, input: { price: string; compareAtPrice: string }, now = new Date()): Promise<PriceResult> {
  const userId = adminId(actor, "price.update");
  if (!IS_UUID.test(variantId)) return { status: "not_found" };
  const variant = await getVariant(db(), variantId);
  if (!variant) return { status: "not_found" };
  const categoryIds = await productCategoryIds(db(), variant.productId);
  if (!categoryIds) return { status: "not_found" };
  const direct = allows(actor, "price.update", categoryIds);
  await authorize(actor, direct ? "price.update" : "price.update.propose", { type: "product_variant", id: variantId, categoryIds });

  const parsed = parsePriceChange(input, await getDisplayUnit());
  if ("error" in parsed) return { status: "invalid", field: parsed.error };
  if (parsed.price === variant.price && parsed.compareAtPrice === variant.compareAtPrice) return { status: "unchanged" };

  if (direct) {
    await transaction(async (tx) => {
      await setTransactionActor(tx, userId);
      await setVariantPriceRow(tx, variantId, parsed.price, parsed.compareAtPrice);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "price.changed",
        entityType: "product_variant",
        entityId: variantId,
        before: { price: variant.price.toString(), compareAtPrice: variant.compareAtPrice?.toString() ?? null },
        after: { price: parsed.price.toString(), compareAtPrice: parsed.compareAtPrice?.toString() ?? null },
      });
    });
    return { status: "applied" };
  }

  if (await pendingApprovalFor(db(), variantId, now)) return { status: "pending_exists" };
  const payload: PricePayload = {
    variantId,
    productId: variant.productId,
    price: parsed.price.toString(),
    compareAtPrice: parsed.compareAtPrice?.toString() ?? null,
    previousPrice: variant.price.toString(),
    previousCompareAtPrice: variant.compareAtPrice?.toString() ?? null,
  };
  const expiresAt = new Date(now.getTime() + (await getApprovalTtlHours()) * 3_600_000);
  const approvalId = await transaction(async (tx) => {
    const id = await insertPriceApproval(tx, { payload, requestedById: userId, expiresAt });
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "price.proposed", entityType: "product_variant", entityId: variantId, after: { ...payload, approvalId: id } });
    return id;
  });
  return { status: "proposed", approvalId };
}

/** Purchase cost (finance data): needs price.update and a finance view permission. */
export async function changeCost(actor: Actor, variantId: string, input: { costPrice: string }): Promise<PriceResult> {
  const userId = adminId(actor, "price.update");
  if (!IS_UUID.test(variantId)) return { status: "not_found" };
  const variant = await getVariant(db(), variantId);
  if (!variant) return { status: "not_found" };
  const categoryIds = await productCategoryIds(db(), variant.productId);
  if (!categoryIds) return { status: "not_found" };
  await authorize(actor, "price.update", { type: "product_variant", id: variantId, categoryIds });
  if (!canSeeCost(actor)) await authorize(actor, "accounting.view", { type: "product_variant", id: variantId });
  let cost: Rial | null = null;
  if (input.costPrice.trim() !== "") {
    const parsed = parsePriceChange({ price: input.costPrice, compareAtPrice: "" }, await getDisplayUnit());
    if ("error" in parsed) return { status: "invalid", field: "invalid_cost" };
    cost = parsed.price;
  }
  if (cost === variant.costPrice) return { status: "unchanged" };
  await transaction(async (tx) => {
    await setVariantCostRow(tx, variantId, cost);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "price.cost_changed",
      entityType: "product_variant",
      entityId: variantId,
      before: { costPrice: variant.costPrice?.toString() ?? null },
      after: { costPrice: cost?.toString() ?? null },
    });
  });
  return { status: "applied" };
}

// ---------------------------------------------------------------------------
// Part numbers and barcodes
// ---------------------------------------------------------------------------

export async function addIdentifier(actor: Actor, productId: string, input: IdentifierInput): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  if (!(await loadScope(actor, productId, "product.update"))) return { status: "not_found" };
  const parsed = identifierInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  if (parsed.data.brandId && !(await getBrand(db(), parsed.data.brandId))) return { status: "invalid", field: "invalid_brand" };
  try {
    const id = await transaction(async (tx) => {
      const id = await insertIdentifier(tx, productId, parsed.data);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "product.identifier_added",
        entityType: "product",
        entityId: productId,
        after: { type: parsed.data.type, value: parsed.data.value },
      });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "taken", field: "identifier" };
    throw error;
  }
}

export async function removeIdentifier(actor: Actor, productId: string, identifierId: string): Promise<ProductResult> {
  const userId = adminId(actor, "product.update");
  if (!IS_UUID.test(identifierId) || !(await loadScope(actor, productId, "product.update"))) return { status: "not_found" };
  const removed = await transaction(async (tx) => {
    const row = await deleteIdentifierRow(tx, productId, identifierId);
    if (row) {
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "product.identifier_removed", entityType: "product", entityId: productId, before: row });
    }
    return row;
  });
  return removed ? { status: "ok", id: identifierId } : { status: "not_found" };
}
