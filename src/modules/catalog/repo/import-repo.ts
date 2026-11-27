/**
 * Database access for product imports: the import jobs and their rows, and
 * the catalog lookups a row is checked against.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

export async function insertImportJob(client: DbClient, job: { fileMediaId: string; originalName: string; createdById: string }): Promise<string> {
  const row = await client.dataImportJob.create({ data: { type: "products", ...job }, select: { id: true } });
  return row.id;
}

const jobSelect = {
  id: true,
  status: true,
  originalName: true,
  dryRunReport: true,
  totalRows: true,
  validRows: true,
  invalidRows: true,
  appliedRows: true,
  createdAt: true,
  confirmedAt: true,
  finishedAt: true,
  createdBy: { select: { username: true, name: true } },
} satisfies Prisma.DataImportJobSelect;

export async function listImportJobs(client: DbClient, take = 30) {
  return client.dataImportJob.findMany({ where: { type: "products" }, orderBy: { createdAt: "desc" }, take, select: jobSelect });
}

export async function getImportJob(client: DbClient, id: string) {
  return client.dataImportJob.findFirst({ where: { id, type: "products" }, select: { ...jobSelect, confirmedById: true, fileMediaId: true } });
}

export async function importRowsWithStatus(client: DbClient, jobId: string, statuses: readonly ("valid" | "invalid" | "created" | "updated" | "skipped" | "failed")[], take: number) {
  return client.dataImportRow.findMany({
    where: { jobId, status: { in: [...statuses] } },
    orderBy: { rowNumber: "asc" },
    take,
    select: { id: true, rowNumber: true, status: true, data: true, errors: true, entityId: true },
  });
}

/**
 * Takes the oldest uploaded job for checking (or one whose check stopped
 * half-way more than 10 minutes ago). SKIP LOCKED: two runners never take
 * the same job.
 */
export async function claimJobToValidate(client: DbClient, now: Date): Promise<{ id: string; fileMediaId: string } | null> {
  const stale = new Date(now.getTime() - 10 * 60_000);
  const rows = await client.$queryRaw<{ id: string; file_media_id: string }[]>`
    UPDATE data_import_jobs SET status = 'validating', updated_at = ${now}
    WHERE id = (
      SELECT id FROM data_import_jobs
      WHERE type = 'products' AND (status = 'uploaded' OR (status = 'validating' AND updated_at < ${stale}))
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, file_media_id`;
  const row = rows[0];
  return row ? { id: row.id, fileMediaId: row.file_media_id } : null;
}

export interface CheckedImportRow {
  rowNumber: number;
  status: "valid" | "invalid";
  data: Prisma.InputJsonValue;
  errors: string[] | null;
}

/** Stores the checked rows and the dry-run report; the job becomes validated. */
export async function saveValidation(
  tx: Tx,
  jobId: string,
  rows: readonly CheckedImportRow[],
  report: Prisma.InputJsonValue,
): Promise<boolean> {
  await tx.dataImportRow.deleteMany({ where: { jobId } });
  for (let i = 0; i < rows.length; i += 500) {
    await tx.dataImportRow.createMany({
      data: rows.slice(i, i + 500).map((r) => ({ jobId, rowNumber: r.rowNumber, status: r.status, data: r.data, errors: r.errors ?? undefined })),
    });
  }
  const valid = rows.filter((r) => r.status === "valid").length;
  const { count } = await tx.dataImportJob.updateMany({
    where: { id: jobId, status: "validating" },
    data: { status: "validated", dryRunReport: report, totalRows: rows.length, validRows: valid, invalidRows: rows.length - valid },
  });
  return count === 1;
}

export async function failJob(client: DbClient, jobId: string, from: "validating" | "applying", report: Prisma.InputJsonValue, now: Date): Promise<void> {
  await client.dataImportJob.updateMany({ where: { id: jobId, status: from }, data: { status: "failed", dryRunReport: report, finishedAt: now } });
}

/** validated -> applying, only when there is something to apply. */
export async function confirmJobRow(tx: Tx, jobId: string, userId: string, now: Date): Promise<boolean> {
  const { count } = await tx.dataImportJob.updateMany({
    where: { id: jobId, type: "products", status: "validated", validRows: { gt: 0 } },
    data: { status: "applying", confirmedById: userId, confirmedAt: now },
  });
  return count === 1;
}

export async function cancelJobRow(tx: Tx, jobId: string, now: Date): Promise<boolean> {
  const { count } = await tx.dataImportJob.updateMany({
    where: { id: jobId, type: "products", status: { in: ["uploaded", "validated"] } },
    data: { status: "cancelled", finishedAt: now },
  });
  return count === 1;
}

export async function nextJobToApply(client: DbClient) {
  return client.dataImportJob.findFirst({
    where: { type: "products", status: "applying" },
    orderBy: { confirmedAt: "asc" },
    select: { id: true, confirmedById: true },
  });
}

/** Records a row's outcome; only a row still waiting is changed, so a row is never applied twice. */
export async function setRowResult(
  client: DbClient,
  rowId: string,
  result: { status: "created" | "updated" | "skipped" | "failed"; entityId: string | null; errors: string[] | null },
): Promise<void> {
  await client.dataImportRow.updateMany({
    where: { id: rowId, status: "valid" },
    data: { status: result.status, entityId: result.entityId, errors: result.errors ?? undefined },
  });
}

export async function finishJobRow(client: DbClient, jobId: string, now: Date): Promise<{ applied: number; failed: number }> {
  const counts = await client.dataImportRow.groupBy({ by: ["status"], where: { jobId }, _count: { _all: true } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const applied = count("created") + count("updated");
  await client.dataImportJob.updateMany({ where: { id: jobId, status: "applying" }, data: { status: "completed", appliedRows: applied, finishedAt: now } });
  return { applied, failed: count("failed") };
}

// Catalog lookups -------------------------------------------------------------

/** Slug (either language) -> id for categories and brands that are not deleted. */
export async function slugIds(client: DbClient): Promise<{ categories: { slug: string; id: string }[]; brands: { slug: string; id: string }[] }> {
  const [categories, brands] = await Promise.all([
    client.categoryTranslation.findMany({ where: { category: { deletedAt: null } }, select: { slug: true, categoryId: true } }),
    client.brandTranslation.findMany({ where: { brand: { deletedAt: null } }, select: { slug: true, brandId: true } }),
  ]);
  return {
    categories: categories.map((c) => ({ slug: c.slug, id: c.categoryId })),
    brands: brands.map((b) => ({ slug: b.slug, id: b.brandId })),
  };
}

/** Existing variants by normalized SKU. */
export async function variantsBySku(client: DbClient, skus: readonly string[]) {
  if (skus.length === 0) return [];
  return client.productVariant.findMany({
    where: { skuNormalized: { in: [...skus] }, deletedAt: null, product: { deletedAt: null } },
    select: { id: true, skuNormalized: true, productId: true, isDefault: true },
  });
}

/** The product's part numbers already on file (normalized), to skip ones it has. */
export async function productIdentifierKeys(client: DbClient, productId: string): Promise<Set<string>> {
  const rows = await client.productIdentifier.findMany({ where: { productId }, select: { normalizedValue: true } });
  return new Set(rows.map((r) => r.normalizedValue));
}
