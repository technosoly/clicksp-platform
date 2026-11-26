/**
 * Database access for the catalog admin (Phase 6): categories, brands,
 * products, variants, prices, part numbers and price approvals. Every
 * function takes a client so services can run it inside a transaction.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { BrandData, CategoryData, LocalizedName, ProductDetails, ProductStatusKey, VariantDetails } from "../domain/catalog-input";

type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Text of a database error raised by a trigger or CHECK (for mapping to form errors). */
export function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sets the acting user (and approval) for trigger-written history rows in this transaction. */
export async function setTransactionActor(tx: Tx, actorId: string | null, approvalId: string | null = null): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${actorId ?? ""}, true), set_config('app.approval_id', ${approvalId ?? ""}, true)`;
}

type Names = Record<"fa" | "en", { name: string; slug: string } | undefined>;

function namesOf(rows: { locale: string; name: string; slug: string }[]): Names {
  const fa = rows.find((r) => r.locale === "fa");
  const en = rows.find((r) => r.locale === "en");
  return { fa: fa ? { name: fa.name, slug: fa.slug } : undefined, en: en ? { name: en.name, slug: en.slug } : undefined };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: string;
  parentId: string | null;
  depth: number;
  isVehicleSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  names: Names;
  productCount: number;
}

/** Every category (not deleted), in tree order (parents before children). */
export async function listCategories(client: DbClient): Promise<CategoryRow[]> {
  const rows = await client.category.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      parentId: true,
      depth: true,
      isVehicleSystem: true,
      isActive: true,
      sortOrder: true,
      translations: { select: { locale: true, name: true, slug: true } },
      _count: { select: { products: true } },
    },
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    depth: r.depth,
    isVehicleSystem: r.isVehicleSystem,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    names: namesOf(r.translations),
    productCount: r._count.products,
  }));
  return treeOrder(mapped);
}

/** Depth-first order, siblings by sort order then Persian name. */
export function treeOrder<T extends { id: string; parentId: string | null; sortOrder: number; names: Names }>(rows: T[]): T[] {
  const children = new Map<string | null, T[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    children.set(key, [...(children.get(key) ?? []), row]);
  }
  const out: T[] = [];
  const visit = (parent: string | null) => {
    const list = (children.get(parent) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || (a.names.fa?.name ?? "").localeCompare(b.names.fa?.name ?? "", "fa"),
    );
    for (const row of list) {
      out.push(row);
      visit(row.id);
    }
  };
  visit(null);
  return out;
}

export async function getCategory(client: DbClient, id: string) {
  const row = await client.category.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      depth: true,
      isVehicleSystem: true,
      isActive: true,
      sortOrder: true,
      translations: { select: { locale: true, name: true, slug: true } },
    },
  });
  return row ? { ...row, names: namesOf(row.translations) } : null;
}

/** The category and all categories below it. */
export async function categoryWithDescendants(client: DbClient, id: string): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE t AS (
      SELECT id FROM categories WHERE id = ${id}::uuid
      UNION SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id)
    SELECT id::text FROM t`;
  return rows.map((r) => r.id);
}

async function writeNames(
  tx: Tx,
  model: "categoryTranslation" | "brandTranslation",
  owner: { categoryId: string } | { brandId: string },
  names: LocalizedName[],
): Promise<void> {
  const delegate = tx[model] as unknown as {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  const ownerKey = Object.keys(owner)[0] as "categoryId" | "brandId";
  const ownerId = Object.values(owner)[0] as string;
  for (const n of names) {
    await delegate.upsert({
      where: { [`${ownerKey}_locale`]: { [ownerKey]: ownerId, locale: n.locale } },
      create: { [ownerKey]: ownerId, locale: n.locale, name: n.name, slug: n.slug, searchName: n.searchName },
      update: { name: n.name, slug: n.slug, searchName: n.searchName },
    });
  }
  // English removed in the form: drop its row (Persian is always present).
  if (!names.some((n) => n.locale === "en")) await delegate.deleteMany({ where: { [ownerKey]: ownerId, locale: "en" } });
}

export async function insertCategory(tx: Tx, data: CategoryData): Promise<string> {
  const row = await tx.category.create({
    data: { parentId: data.parentId, isVehicleSystem: data.isVehicleSystem, isActive: data.isActive, sortOrder: data.sortOrder },
    select: { id: true },
  });
  await writeNames(tx, "categoryTranslation", { categoryId: row.id }, data.names);
  return row.id;
}

export async function updateCategoryRow(tx: Tx, id: string, data: CategoryData): Promise<void> {
  await tx.category.update({
    where: { id },
    data: { parentId: data.parentId, isVehicleSystem: data.isVehicleSystem, isActive: data.isActive, sortOrder: data.sortOrder },
  });
  await writeNames(tx, "categoryTranslation", { categoryId: id }, data.names);
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export interface BrandRow {
  id: string;
  isGenuine: boolean;
  isActive: boolean;
  sortOrder: number;
  names: Names;
  productCount: number;
}

export async function listBrands(client: DbClient): Promise<BrandRow[]> {
  const rows = await client.brand.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      isGenuine: true,
      isActive: true,
      sortOrder: true,
      translations: { select: { locale: true, name: true, slug: true } },
      _count: { select: { products: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    isGenuine: r.isGenuine,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    names: namesOf(r.translations),
    productCount: r._count.products,
  }));
}

export async function getBrand(client: DbClient, id: string) {
  const row = await client.brand.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, isGenuine: true, isActive: true, sortOrder: true, translations: { select: { locale: true, name: true, slug: true } } },
  });
  return row ? { ...row, names: namesOf(row.translations) } : null;
}

export async function insertBrand(tx: Tx, data: BrandData): Promise<string> {
  const row = await tx.brand.create({ data: { isGenuine: data.isGenuine, isActive: data.isActive, sortOrder: data.sortOrder }, select: { id: true } });
  await writeNames(tx, "brandTranslation", { brandId: row.id }, data.names);
  return row.id;
}

export async function updateBrandRow(tx: Tx, id: string, data: BrandData): Promise<void> {
  await tx.brand.update({ where: { id }, data: { isGenuine: data.isGenuine, isActive: data.isActive, sortOrder: data.sortOrder } });
  await writeNames(tx, "brandTranslation", { brandId: id }, data.names);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductListRow {
  id: string;
  status: ProductStatusKey;
  faTitle: string | null;
  enTitle: string | null;
  sku: string | null;
  price: bigint | null;
  brandName: string | null;
  categoryName: string | null;
  updatedAt: Date;
}

export const PRODUCT_PAGE_SIZE = 50;

/**
 * Products matching the filters. `allowedCategoryIds` null = every product;
 * otherwise only products whose categories (primary and extra) all lie in
 * that set, matching how authorize() checks a scoped grant.
 */
export async function listProducts(
  client: DbClient,
  filter: { search: string | null; skuSearch: string | null; status: ProductStatusKey | null; categoryId: string | null; allowedCategoryIds: string[] | null; page: number },
): Promise<{ rows: ProductListRow[]; hasMore: boolean }> {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`];
  if (filter.status) conditions.push(Prisma.sql`p.status = ${filter.status}::product_status`);
  if (filter.categoryId) {
    conditions.push(Prisma.sql`(p.primary_category_id = ${filter.categoryId}::uuid
      OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ${filter.categoryId}::uuid))`);
  }
  if (filter.allowedCategoryIds) {
    const allowed = filter.allowedCategoryIds;
    conditions.push(Prisma.sql`p.primary_category_id = ANY(${allowed}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND NOT (pc.category_id = ANY(${allowed}::uuid[])))`);
  }
  if (filter.search || filter.skuSearch) {
    const like = `%${(filter.search ?? "").replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const skuLike = `%${(filter.skuSearch ?? "").replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(Prisma.sql`(
      (${filter.search !== null && filter.search !== ""} AND EXISTS (SELECT 1 FROM product_translations t WHERE t.product_id = p.id AND t.search_title LIKE ${like}))
      OR (${filter.skuSearch !== null && filter.skuSearch !== ""} AND (
        EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.sku_normalized LIKE ${skuLike})
        OR EXISTS (SELECT 1 FROM product_identifiers i WHERE i.product_id = p.id AND i.normalized_value LIKE ${skuLike}))))`);
  }
  const offset = (filter.page - 1) * PRODUCT_PAGE_SIZE;
  const rows = await client.$queryRaw<
    { id: string; status: ProductStatusKey; fa_title: string | null; en_title: string | null; sku: string | null; price: bigint | null; brand_name: string | null; category_name: string | null; updated_at: Date }[]
  >`
    SELECT p.id::text, p.status::text AS status,
           (SELECT title FROM product_translations WHERE product_id = p.id AND locale = 'fa') AS fa_title,
           (SELECT title FROM product_translations WHERE product_id = p.id AND locale = 'en') AS en_title,
           v.sku, v.price,
           (SELECT name FROM brand_translations WHERE brand_id = p.brand_id AND locale = 'fa') AS brand_name,
           (SELECT name FROM category_translations WHERE category_id = p.primary_category_id AND locale = 'fa') AS category_name,
           p.updated_at
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_default AND v.deleted_at IS NULL
     WHERE ${Prisma.join(conditions, " AND ")}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ${PRODUCT_PAGE_SIZE + 1} OFFSET ${offset}`;
  return {
    rows: rows.slice(0, PRODUCT_PAGE_SIZE).map((r) => ({
      id: r.id,
      status: r.status,
      faTitle: r.fa_title,
      enTitle: r.en_title,
      sku: r.sku,
      price: r.price,
      brandName: r.brand_name,
      categoryName: r.category_name,
      updatedAt: r.updated_at,
    })),
    hasMore: rows.length > PRODUCT_PAGE_SIZE,
  };
}

/** The product's categories: its primary category and every extra one. */
export async function productCategoryIds(client: DbClient, productId: string): Promise<string[] | null> {
  const product = await client.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { primaryCategoryId: true, categories: { select: { categoryId: true } } },
  });
  if (!product) return null;
  return [...new Set([product.primaryCategoryId, ...product.categories.map((c) => c.categoryId)].filter((v): v is string => v !== null))];
}

export async function getProductDetail(client: DbClient, productId: string) {
  return client.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      status: true,
      brandId: true,
      primaryCategoryId: true,
      warrantyMonths: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      translations: { select: { locale: true, title: true, slug: true, shortDescription: true } },
      categories: { select: { categoryId: true }, orderBy: { sortOrder: "asc" } },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          sku: true,
          isDefault: true,
          price: true,
          compareAtPrice: true,
          costPrice: true,
          weightGrams: true,
          lengthMm: true,
          widthMm: true,
          heightMm: true,
          minOrderQty: true,
          maxOrderQty: true,
          isActive: true,
        },
      },
      identifiers: {
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: { id: true, type: true, value: true, brandId: true, variantId: true },
      },
    },
  });
}

async function writeProductTexts(tx: Tx, productId: string, details: ProductDetails): Promise<void> {
  for (const t of details.texts) {
    await tx.productTranslation.upsert({
      where: { productId_locale: { productId, locale: t.locale } },
      create: { productId, locale: t.locale, title: t.title, slug: t.slug, shortDescription: t.shortDescription, searchTitle: t.searchTitle },
      update: { title: t.title, slug: t.slug, shortDescription: t.shortDescription, searchTitle: t.searchTitle },
    });
  }
  if (!details.texts.some((t) => t.locale === "en")) await tx.productTranslation.deleteMany({ where: { productId, locale: "en" } });
  await tx.productCategory.deleteMany({ where: { productId, categoryId: { notIn: details.categoryIds } } });
  for (const [index, categoryId] of details.categoryIds.entries()) {
    await tx.productCategory.upsert({
      where: { productId_categoryId: { productId, categoryId } },
      create: { productId, categoryId, sortOrder: index },
      update: { sortOrder: index },
    });
  }
}

/** A new draft product with its default variant (price as given, 0 = not priced yet). */
export async function insertProduct(
  tx: Tx,
  input: { details: ProductDetails; sku: { sku: string; skuNormalized: string }; price: bigint; compareAtPrice: bigint | null; actorId: string },
): Promise<{ productId: string; variantId: string }> {
  const product = await tx.product.create({
    data: {
      status: "draft",
      brandId: input.details.brandId,
      primaryCategoryId: input.details.primaryCategoryId,
      warrantyMonths: input.details.warrantyMonths,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
    select: { id: true },
  });
  await writeProductTexts(tx, product.id, input.details);
  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: input.sku.sku,
      skuNormalized: input.sku.skuNormalized,
      isDefault: true,
      price: input.price,
      compareAtPrice: input.compareAtPrice,
    },
    select: { id: true },
  });
  return { productId: product.id, variantId: variant.id };
}

export async function updateProductRow(tx: Tx, productId: string, details: ProductDetails, actorId: string): Promise<void> {
  await tx.product.update({
    where: { id: productId },
    data: { brandId: details.brandId, primaryCategoryId: details.primaryCategoryId, warrantyMonths: details.warrantyMonths, updatedById: actorId },
  });
  await writeProductTexts(tx, productId, details);
}

export async function setProductStatusRow(tx: Tx, productId: string, status: ProductStatusKey, actorId: string, now: Date): Promise<void> {
  const current = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { publishedAt: true } });
  await tx.product.update({
    where: { id: productId },
    data: { status, updatedById: actorId, publishedAt: status === "active" ? (current.publishedAt ?? now) : current.publishedAt },
  });
}

export async function insertVariant(tx: Tx, productId: string, details: VariantDetails): Promise<string> {
  const row = await tx.productVariant.create({
    data: {
      productId,
      sku: details.sku.sku,
      skuNormalized: details.sku.skuNormalized,
      isDefault: false,
      price: 0n,
      weightGrams: details.weightGrams,
      lengthMm: details.lengthMm,
      widthMm: details.widthMm,
      heightMm: details.heightMm,
      minOrderQty: details.minOrderQty,
      maxOrderQty: details.maxOrderQty,
      isActive: details.isActive,
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateVariantRow(tx: Tx, variantId: string, details: VariantDetails): Promise<void> {
  await tx.productVariant.update({
    where: { id: variantId },
    data: {
      sku: details.sku.sku,
      skuNormalized: details.sku.skuNormalized,
      weightGrams: details.weightGrams,
      lengthMm: details.lengthMm,
      widthMm: details.widthMm,
      heightMm: details.heightMm,
      minOrderQty: details.minOrderQty,
      maxOrderQty: details.maxOrderQty,
      isActive: details.isActive,
    },
  });
}

export async function getVariant(client: DbClient, variantId: string) {
  return client.productVariant.findFirst({
    where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
    select: { id: true, productId: true, sku: true, isDefault: true, isActive: true, price: true, compareAtPrice: true, costPrice: true },
  });
}

/**
 * Sets a variant's price. The database trigger writes the history row with
 * the transaction's actor (and approval), so callers set those first.
 */
export async function setVariantPriceRow(tx: Tx, variantId: string, price: bigint, compareAtPrice: bigint | null): Promise<void> {
  await tx.productVariant.update({ where: { id: variantId }, data: { price, compareAtPrice } });
}

/**
 * Sets a variant's price only if it still has the given price and
 * compare-at price (checked by the UPDATE itself, so a concurrent change
 * cannot be overwritten). Returns false when nothing matched.
 */
export async function setVariantPriceIfUnchanged(
  tx: Tx,
  variantId: string,
  previous: { price: bigint; compareAtPrice: bigint | null },
  next: { price: bigint; compareAtPrice: bigint | null },
): Promise<boolean> {
  const { count } = await tx.productVariant.updateMany({
    where: { id: variantId, deletedAt: null, price: previous.price, compareAtPrice: previous.compareAtPrice },
    data: { price: next.price, compareAtPrice: next.compareAtPrice },
  });
  return count === 1;
}

export async function setVariantCostRow(tx: Tx, variantId: string, costPrice: bigint | null): Promise<void> {
  await tx.productVariant.update({ where: { id: variantId }, data: { costPrice } });
}

export async function priceHistory(client: DbClient, variantId: string, limit = 20) {
  const rows = await client.productPrice.findMany({
    where: { variantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      price: true,
      compareAtPrice: true,
      createdAt: true,
      approvalId: true,
      changedBy: { select: { username: true, name: true } },
    },
  });
  return rows;
}

export async function insertIdentifier(
  tx: Tx,
  productId: string,
  input: { type: string; value: string; normalizedValue: string; brandId: string | null },
): Promise<string> {
  const row = await tx.productIdentifier.create({
    data: {
      productId,
      type: input.type as "oem",
      value: input.value,
      normalizedValue: input.normalizedValue,
      brandId: input.brandId,
    },
    select: { id: true },
  });
  return row.id;
}

export async function deleteIdentifierRow(tx: Tx, productId: string, identifierId: string) {
  const row = await tx.productIdentifier.findFirst({ where: { id: identifierId, productId }, select: { type: true, value: true } });
  if (!row) return null;
  await tx.productIdentifier.delete({ where: { id: identifierId } });
  return row;
}

// ---------------------------------------------------------------------------
// Price approvals
// ---------------------------------------------------------------------------

export const PRICE_APPROVAL_ACTION = "price.update";

export interface PricePayload {
  variantId: string;
  productId: string;
  price: string;
  compareAtPrice: string | null;
  /** Price when the request was made; the change fails if it moved since. */
  previousPrice: string;
  previousCompareAtPrice: string | null;
}

export async function insertPriceApproval(tx: Tx, input: { payload: PricePayload; requestedById: string; expiresAt: Date }): Promise<string> {
  const row = await tx.adminApproval.create({
    data: {
      action: PRICE_APPROVAL_ACTION,
      entityType: "product_variant",
      entityId: input.payload.variantId,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      requestedById: input.requestedById,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  return row.id;
}

export async function pendingApprovalFor(client: DbClient, variantId: string, now: Date) {
  return client.adminApproval.findFirst({
    where: { action: PRICE_APPROVAL_ACTION, entityId: variantId, status: "pending", expiresAt: { gt: now } },
    select: { id: true, requestedById: true },
  });
}

export async function listPriceApprovals(
  client: DbClient,
  filter: { status: "pending" | "decided"; requestedById: string | null; allowedCategoryIds: string[] | null; now: Date },
) {
  const rows = await client.adminApproval.findMany({
    where: {
      action: PRICE_APPROVAL_ACTION,
      ...(filter.status === "pending" ? { status: "pending", expiresAt: { gt: filter.now } } : { NOT: { status: "pending" } }),
      ...(filter.requestedById ? { requestedById: filter.requestedById } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      payload: true,
      entityId: true,
      decisionNote: true,
      decidedAt: true,
      createdAt: true,
      expiresAt: true,
      error: true,
      requestedById: true,
      requestedBy: { select: { username: true, name: true } },
      decidedBy: { select: { username: true, name: true } },
    },
  });
  const variantIds = rows.map((r) => r.entityId).filter((v): v is string => v !== null);
  const variants = await client.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      price: true,
      product: {
        select: {
          id: true,
          primaryCategoryId: true,
          categories: { select: { categoryId: true } },
          translations: { where: { locale: "fa" }, select: { title: true } },
        },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  return rows
    .map((r) => {
      const v = r.entityId ? byId.get(r.entityId) : undefined;
      const categoryIds = v ? [v.product.primaryCategoryId, ...v.product.categories.map((c) => c.categoryId)].filter((c): c is string => c !== null) : [];
      return {
        ...r,
        payload: r.payload as unknown as PricePayload,
        variant: v ? { id: v.id, sku: v.sku, currentPrice: v.price, productId: v.product.id, title: v.product.translations[0]?.title ?? null, categoryIds } : null,
      };
    })
    .filter((r) => !filter.allowedCategoryIds || (r.variant && r.variant.categoryIds.every((c) => filter.allowedCategoryIds!.includes(c))));
}

export async function getApproval(client: DbClient, approvalId: string) {
  const row = await client.adminApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, action: true, status: true, payload: true, entityId: true, requestedById: true, expiresAt: true },
  });
  return row ? { ...row, payload: row.payload as unknown as PricePayload } : null;
}

/** Records a decision on a pending request; false when someone else decided it first. */
export async function decideApprovalRow(
  tx: Tx,
  approvalId: string,
  decision: { status: "approved" | "rejected" | "cancelled" | "expired"; decidedById: string | null; note: string | null; at: Date },
): Promise<boolean> {
  const result = await tx.adminApproval.updateMany({
    where: { id: approvalId, status: "pending" },
    data: {
      status: decision.status,
      decidedById: decision.decidedById,
      decidedAt: decision.decidedById ? decision.at : null,
      decisionNote: decision.note,
    },
  });
  return result.count === 1;
}

export async function finishApprovalRow(tx: Tx, approvalId: string, outcome: { status: "executed" | "failed"; error: string | null; at: Date }): Promise<void> {
  await tx.adminApproval.update({
    where: { id: approvalId },
    data: { status: outcome.status, executedAt: outcome.status === "executed" ? outcome.at : null, error: outcome.error },
  });
}
