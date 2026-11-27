import "server-only";
import { db } from "@/lib/db";
import { normalizeForSearch, normalizeForStorage, normalizeIdentifier, toEnDigits } from "@/lib/persian-text";
import type { Rendition } from "@/modules/media/domain/image-rules";
import {
  categoryBySlug,
  categoryChainActive,
  categoryCrumb,
  categoryForShop,
  categoryWithDescendants,
  productCards,
  productCardsByIdList,
  productsForSearch,
  productForShop,
  productIdBySlug,
  lockPurchasableVariants,
  purchasableVariants,
  searchWhere,
  servableRenditions,
  topCategories,
  type ProductCardRow,
} from "../repo/storefront-repo";

/**
 * The public catalog for the storefront. These reads need no actor: they
 * return only what any visitor may see (published products, active
 * categories and brands, public images), never costs or internal fields.
 * Anything that changes data or shows a customer's own data takes an actor.
 */

export type ShopLocale = "fa" | "en";
export const PAGE_SIZE = 24;


/** The row for the locale, else the Persian one (always present for business content). */
export function pick<T extends { locale: string }>(rows: readonly T[], locale: ShopLocale): T | undefined {
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "fa") ?? rows[0];
}

function altText(alt: unknown, locale: ShopLocale, fallback: string): string {
  if (alt && typeof alt === "object") {
    const value = (alt as Record<string, unknown>)[locale] ?? (alt as Record<string, unknown>).fa;
    if (typeof value === "string" && value) return value;
  }
  return fallback;
}

export interface ProductCard {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  sku: string;
  variantId: string;
  price: bigint;
  compareAtPrice: bigint | null;
  image: { renditions: Rendition[]; alt: string };
}

function toCard(row: ProductCardRow, locale: ShopLocale): ProductCard | null {
  const text = pick(row.translations, locale);
  const variant = row.variants[0];
  if (!text || !variant) return null;
  const image = row.images[0];
  return {
    id: row.id,
    title: text.title,
    slug: text.slug,
    brand: row.brand?.isActive && !row.brand.deletedAt ? (pick(row.brand.translations, locale)?.name ?? null) : null,
    sku: variant.sku,
    variantId: variant.id,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice && variant.compareAtPrice > variant.price ? variant.compareAtPrice : null,
    image: { renditions: image ? servableRenditions(image.media) : [], alt: image ? altText(image.alt, locale, text.title) : text.title },
  };
}

const cards = (rows: ProductCardRow[], locale: ShopLocale) => rows.map((r) => toCard(r, locale)).filter((c): c is ProductCard => c !== null);

/** Page numbers from the URL: 1..1000, anything else is page 1. */
export function pageNumber(input: string | string[] | undefined): number {
  const n = typeof input === "string" ? Number(toEnDigits(input)) : 1;
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}

// Home -------------------------------------------------------------------------

export async function shopHome(locale: ShopLocale) {
  const [categories, latest] = await Promise.all([topCategories(db()), productCards(db(), {}, 0, 8)]);
  return {
    categories: categories.map((c) => {
      const text = pick(c.translations, locale);
      return { id: c.id, name: text?.name ?? "", slug: text?.slug ?? "", renditions: servableRenditions(c.image) };
    }),
    latest: cards(latest.rows, locale),
  };
}

// Categories -------------------------------------------------------------------

/** The category for a URL slug (any locale's slug works; the page links the locale's own). */
export async function categoryPage(locale: ShopLocale, slug: string, page: number, onlyProductIds: readonly string[] | null = null) {
  const matches = await categoryBySlug(db(), slug.slice(0, 160));
  const match = matches.find((m) => m.locale === locale) ?? matches[0];
  if (!match) return null;
  const category = await categoryForShop(db(), match.categoryId);
  // A category under a switched-off parent is hidden with it.
  if (!category || !(await categoryChainActive(db(), category.id))) return null;

  // Breadcrumbs up the tree (bounded; stops at an inactive parent).
  const crumbs: { name: string; slug: string }[] = [];
  let parentId = category.parentId;
  for (let i = 0; parentId && i < 10; i += 1) {
    const parent = await categoryCrumb(db(), parentId);
    if (!parent || !parent.isActive || parent.deletedAt) break;
    const text = pick(parent.translations, locale);
    crumbs.unshift({ name: text?.name ?? "", slug: text?.slug ?? "" });
    parentId = parent.parentId;
  }

  const ids = await categoryWithDescendants(db(), category.id);
  const where = {
    categories: { some: { categoryId: { in: ids } } },
    ...(onlyProductIds ? { id: { in: [...onlyProductIds] } } : {}),
  };
  const { rows, total } = await productCards(db(), where, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const text = pick(category.translations, locale);
  return {
    id: category.id,
    name: text?.name ?? "",
    slug: text?.slug ?? slug,
    alternates: Object.fromEntries(category.translations.map((t) => [t.locale, t.slug])) as Partial<Record<ShopLocale, string>>,
    crumbs,
    children: category.children.map((c) => {
      const t = pick(c.translations, locale);
      return { id: c.id, name: t?.name ?? "", slug: t?.slug ?? "", renditions: servableRenditions(c.image) };
    }),
    products: cards(rows, locale),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

// Products ---------------------------------------------------------------------

export async function productPage(locale: ShopLocale, slug: string) {
  const matches = await productIdBySlug(db(), slug.slice(0, 260));
  const match = matches.find((m) => m.locale === locale) ?? matches[0];
  if (!match) return null;
  const product = await productForShop(db(), match.productId);
  if (!product) return null;
  const text = pick(product.translations, locale);
  if (!text) return null;

  let category: { name: string; slug: string } | null = null;
  if (product.primaryCategoryId) {
    const c = await categoryCrumb(db(), product.primaryCategoryId);
    if (c?.isActive && !c.deletedAt && (await categoryChainActive(db(), c.id))) {
      const t = pick(c.translations, locale);
      if (t) category = { name: t.name, slug: t.slug };
    }
  }
  return {
    id: product.id,
    title: text.title,
    slug: text.slug,
    shortDescription: text.shortDescription,
    alternates: Object.fromEntries(product.translations.map((t) => [t.locale, t.slug])) as Partial<Record<ShopLocale, string>>,
    brand: product.brand?.isActive && !product.brand.deletedAt ? { name: pick(product.brand.translations, locale)?.name ?? "", isGenuine: product.brand.isGenuine } : null,
    warrantyMonths: product.warrantyMonths,
    category,
    variants: product.variants.map((v) => ({ ...v, compareAtPrice: v.compareAtPrice && v.compareAtPrice > v.price ? v.compareAtPrice : null })),
    images: product.images.map((i) => ({ id: i.id, renditions: servableRenditions(i.media), alt: altText(i.alt, locale, text.title) })).filter((i) => i.renditions.length > 0),
    identifiers: product.identifiers,
  };
}

/** Product cards for a set of ids (e.g. the parts that fit a motorcycle), newest first. */
export async function productCardsByIds(locale: ShopLocale, ids: readonly string[], page: number) {
  const { rows, total } = await productCards(db(), { id: { in: [...ids] } }, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  return { products: cards(rows, locale), total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}


// Search -----------------------------------------------------------------------

export async function searchShop(locale: ShopLocale, query: string, page: number) {
  const { raw, text, identifier } = searchQuery(query);
  if (raw.length < 2) return { query: raw, products: [], total: 0, pages: 1 };
  const { rows, total } = await productCards(db(), searchWhere(text, identifier.length >= 3 ? identifier : ""), (page - 1) * PAGE_SIZE, PAGE_SIZE);
  return { query: raw, products: cards(rows, locale), total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Product cards in the order a search engine ranked them; ids that aren't published are dropped. */
export async function productCardsInOrder(locale: ShopLocale, ids: readonly string[]) {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 100);
  if (wanted.length === 0) return [];
  return cards(await productCardsByIdList(db(), wanted), locale);
}

/**
 * What the search index holds for published products, for the search module
 * (public data only). `after` pages through all of them by id; `ids` asks for
 * particular ones, and an id that is missing from the result is not published.
 */
export async function searchFeed(query: { ids: readonly string[] } | { after: string | null; take: number }) {
  const rows =
    "ids" in query
      ? await productsForSearch(db(), { id: { in: [...query.ids].filter((id) => UUID.test(id)) } }, query.ids.length)
      : await productsForSearch(db(), query.after ? { id: { gt: query.after } } : {}, query.take);
  return rows.map((r) => {
    const t = (locale: "fa" | "en") => r.translations.find((x) => x.locale === locale);
    const brand = r.brand && r.brand.isActive && !r.brand.deletedAt ? r.brand.translations : [];
    return {
      id: r.id,
      publishedAt: r.publishedAt,
      fa: { title: t("fa")?.title ?? null, searchTitle: t("fa")?.searchTitle ?? null, brand: brand.find((b) => b.locale === "fa")?.name ?? null },
      en: { title: t("en")?.title ?? null, searchTitle: t("en")?.searchTitle ?? null, brand: brand.find((b) => b.locale === "en")?.name ?? null },
      // As written and as normalized, so "AB-12 3" and "AB123" both find it.
      skus: r.variants.flatMap((v) => [v.sku, v.skuNormalized]),
      identifiers: r.identifiers.flatMap((i) => [i.value, i.normalizedValue]),
    };
  });
}

/** The query as both search paths read it: digits to ASCII, normalized letters, at most 100 characters. */
export function searchQuery(query: string) {
  const raw = normalizeForStorage(toEnDigits(query.slice(0, 200))).slice(0, 100).trim();
  return { raw, text: normalizeForSearch(raw), identifier: normalizeIdentifier(raw) };
}

// Cart -------------------------------------------------------------------------

export interface ShopVariant {
  variantId: string;
  productId: string;
  sku: string;
  title: string;
  slug: string;
  price: bigint;
  compareAtPrice: bigint | null;
  minQty: number;
  maxQty: number | null;
  /** Shipping weight; null when not entered. */
  weightGrams: number | null;
  /** Persian and English titles, for order snapshots. */
  titles: { fa: string; en: string | null };
  image: { renditions: Rendition[]; alt: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The variants a visitor can buy now, with today's price; ids not in the map can't be bought. */
export async function shopVariants(locale: ShopLocale, ids: readonly string[]): Promise<Map<string, ShopVariant>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 200);
  if (wanted.length === 0) return new Map();
  const rows = await purchasableVariants(db(), wanted);
  const out = new Map<string, ShopVariant>();
  for (const row of rows) {
    const text = pick(row.product.translations, locale);
    if (!text) continue;
    const image = row.product.images[0];
    out.set(row.id, {
      variantId: row.id,
      productId: row.product.id,
      sku: row.sku,
      title: text.title,
      slug: text.slug,
      price: row.price,
      compareAtPrice: row.compareAtPrice && row.compareAtPrice > row.price ? row.compareAtPrice : null,
      minQty: Math.max(1, row.minOrderQty),
      maxQty: row.maxOrderQty,
      weightGrams: row.weightGrams,
      titles: { fa: pick(row.product.translations, "fa")?.title ?? text.title, en: row.product.translations.find((t) => t.locale === "en")?.title ?? null },
      image: { renditions: image ? servableRenditions(image.media) : [], alt: image ? altText(image.alt, locale, text.title) : text.title },
    });
  }
  return out;
}

/** Current prices and limits of still-purchasable variants, locked for the caller's order transaction. */
export async function lockVariantPrices(tx: Parameters<typeof lockPurchasableVariants>[0], ids: readonly string[]) {
  const rows = await lockPurchasableVariants(tx, ids);
  return new Map(rows.map((r) => [r.id, { price: r.price, minQty: Math.max(1, r.min_order_qty), maxQty: r.max_order_qty }]));
}
