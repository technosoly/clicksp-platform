/**
 * The search index document for a product: public fields only (titles,
 * brand, SKUs and part numbers, already normalized the way search queries
 * are), never prices, costs or stock.
 */
export interface ProductDocument {
  id: string;
  fa_title: string;
  en_title: string;
  fa_search: string;
  en_search: string;
  fa_brand: string;
  en_brand: string;
  skus: string[];
  identifiers: string[];
  published_at: number;
}

export interface FeedRow {
  id: string;
  publishedAt: Date | null;
  fa: { title: string | null; searchTitle: string | null; brand: string | null };
  en: { title: string | null; searchTitle: string | null; brand: string | null };
  skus: string[];
  identifiers: string[];
}

export const PRODUCT_INDEX = "products";

/** Index settings: what is searched, in which order of importance, and where typos are not forgiven. */
export const PRODUCT_INDEX_SETTINGS = {
  searchableAttributes: ["skus", "identifiers", "fa_title", "en_title", "fa_search", "en_search", "fa_brand", "en_brand"],
  displayedAttributes: ["id"],
  sortableAttributes: ["published_at"],
  // Part numbers must match as typed (a typo there finds the wrong part).
  typoTolerance: { disableOnAttributes: ["skus", "identifiers"] },
  localizedAttributes: [
    { attributePatterns: ["fa_*"], locales: ["pes"] },
    { attributePatterns: ["en_*"], locales: ["eng"] },
  ],
} as const;

export function productDocument(row: FeedRow): ProductDocument {
  return {
    id: row.id,
    fa_title: row.fa.title ?? "",
    en_title: row.en.title ?? "",
    fa_search: row.fa.searchTitle ?? "",
    en_search: row.en.searchTitle ?? "",
    fa_brand: row.fa.brand ?? "",
    en_brand: row.en.brand ?? "",
    skus: [...new Set(row.skus)],
    identifiers: [...new Set(row.identifiers)],
    published_at: row.publishedAt ? Math.floor(row.publishedAt.getTime() / 1000) : 0,
  };
}
