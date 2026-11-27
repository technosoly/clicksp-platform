/**
 * Read-only queries for the public storefront. Only published products
 * (status active, not deleted, with an active priced default variant), active
 * categories and brands, and public ready images are ever returned, and only
 * the fields customers see: never costs, internal notes or who changed what.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { Rendition } from "@/modules/media/domain/image-rules";

const publicImage = { where: { kind: "image", visibility: "public", status: "ready", deletedAt: null } } as const;
const mediaSelect = { select: { renditions: true, kind: true, visibility: true, status: true, deletedAt: true } } as const;

type MediaRow = { renditions: Prisma.JsonValue; kind: string; visibility: string; status: string; deletedAt: Date | null } | null;

/** Renditions of a public, ready image; [] (placeholder) otherwise. */
export function servableRenditions(media: MediaRow): Rendition[] {
  if (!media || media.kind !== "image" || media.visibility !== "public" || media.status !== "ready" || media.deletedAt) return [];
  return Array.isArray(media.renditions) ? (media.renditions as unknown as Rendition[]) : [];
}

/** What makes a product visible in the shop. */
export const PUBLISHED: Prisma.ProductWhereInput = {
  status: "active",
  deletedAt: null,
  variants: { some: { isDefault: true, isActive: true, deletedAt: null, price: { gt: 0n } } },
};

const nameSelect = { select: { locale: true, name: true, slug: true } } as const;

export const productCardSelect = {
  id: true,
  translations: { select: { locale: true, title: true, slug: true } },
  brand: { select: { isActive: true, translations: { select: { locale: true, name: true } } } },
  variants: {
    where: { isDefault: true, isActive: true, deletedAt: null },
    take: 1,
    select: { id: true, sku: true, price: true, compareAtPrice: true },
  },
  images: {
    where: { media: publicImage.where },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    take: 1,
    select: { alt: true, media: mediaSelect },
  },
} satisfies Prisma.ProductSelect;

export type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof productCardSelect }>;

// Categories ---------------------------------------------------------------------

export async function topCategories(client: DbClient) {
  return client.category.findMany({
    where: { parentId: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, isVehicleSystem: true, translations: nameSelect, image: mediaSelect },
  });
}

export async function categoryBySlug(client: DbClient, slug: string) {
  const rows = await client.categoryTranslation.findMany({
    where: { slug, category: { isActive: true } },
    select: { locale: true, categoryId: true },
  });
  return rows;
}

export async function categoryForShop(client: DbClient, id: string) {
  return client.category.findFirst({
    where: { id, isActive: true },
    select: {
      id: true,
      parentId: true,
      translations: nameSelect,
      image: mediaSelect,
      children: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, translations: nameSelect, image: mediaSelect },
      },
    },
  });
}

export async function categoryCrumb(client: DbClient, id: string) {
  return client.category.findUnique({ where: { id }, select: { id: true, parentId: true, isActive: true, translations: nameSelect } });
}

/** A category and every active category below it. */
export async function categoryWithDescendants(client: DbClient, id: string): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM categories WHERE id = ${id}::uuid AND is_active
      UNION
      SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.is_active
    )
    SELECT id FROM tree`;
  return rows.map((r) => r.id);
}

// Products -----------------------------------------------------------------------

export async function productCards(client: DbClient, where: Prisma.ProductWhereInput, skip: number, take: number) {
  const filter: Prisma.ProductWhereInput = { AND: [PUBLISHED, where] };
  const [rows, total] = await Promise.all([
    client.product.findMany({ where: filter, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip, take, select: productCardSelect }),
    client.product.count({ where: filter }),
  ]);
  return { rows, total };
}

export async function productIdBySlug(client: DbClient, slug: string) {
  return client.productTranslation.findMany({ where: { slug, product: PUBLISHED }, select: { locale: true, productId: true } });
}

export async function productForShop(client: DbClient, id: string) {
  return client.product.findFirst({
    where: { AND: [PUBLISHED, { id }] },
    select: {
      id: true,
      warrantyMonths: true,
      primaryCategoryId: true,
      translations: { select: { locale: true, title: true, slug: true, shortDescription: true } },
      brand: { select: { isActive: true, isGenuine: true, translations: { select: { locale: true, name: true } } } },
      variants: {
        where: { isActive: true, deletedAt: null, price: { gt: 0n } },
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { sku: "asc" }],
        select: { id: true, sku: true, isDefault: true, price: true, compareAtPrice: true, minOrderQty: true, maxOrderQty: true, weightGrams: true },
      },
      images: {
        where: { media: publicImage.where },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
        select: { id: true, alt: true, media: mediaSelect },
      },
      identifiers: {
        where: { type: { in: ["oem", "manufacturer_pn", "alternative_pn", "superseded_pn"] } },
        orderBy: [{ isPrimary: "desc" }, { type: "asc" }, { value: "asc" }],
        select: { type: true, value: true },
      },
    },
  });
}

/** Products whose title, SKU or part number matches (search and identifier forms already normalized). */
export function searchWhere(text: string, identifier: string): Prisma.ProductWhereInput {
  const or: Prisma.ProductWhereInput[] = [];
  if (text) or.push({ translations: { some: { searchTitle: { contains: text, mode: "insensitive" } } } });
  if (identifier) {
    or.push({ identifiers: { some: { normalizedValue: { startsWith: identifier } } } });
    or.push({ variants: { some: { deletedAt: null, skuNormalized: { startsWith: identifier } } } });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}
