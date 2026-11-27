import "server-only";
import { logger } from "@/lib/logger";
import { PAGE_SIZE, productCardsInOrder, searchFeed, searchQuery, searchShop, type ShopLocale } from "@/modules/catalog/service/storefront";
import type { OutboxEvent } from "@/modules/jobs/domain/outbox";
import { PRODUCT_INDEX, PRODUCT_INDEX_SETTINGS, productDocument } from "../domain/product-document";
import { meili, meiliConfig } from "../adapters/meilisearch";

/**
 * Product search. When Meilisearch is set up (MEILISEARCH_HOST) the
 * storefront asks it first and shows the ranked products from the database;
 * when it isn't, or doesn't answer quickly, the database search answers, so
 * search always works. The index is kept current from the outbox (a database
 * trigger writes `search.product_changed` whenever a product, its texts,
 * variants or part numbers change) and rebuilt in full every night.
 */

const SEARCH_TIMEOUT_MS = 1500;
const REBUILD_PAGE = 500;

export async function searchStore(locale: ShopLocale, query: string, page: number) {
  const config = meiliConfig();
  const { raw } = searchQuery(query);
  if (!config || raw.length < 2) return searchShop(locale, query, page);
  try {
    const result = await meili.search(config, PRODUCT_INDEX, { q: raw, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }, SEARCH_TIMEOUT_MS);
    const products = await productCardsInOrder(locale, result.hits.map((h) => h.id));
    const total = result.estimatedTotalHits;
    return { query: raw, products, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  } catch (error) {
    logger.warn("search engine unavailable, using database search", { error: String(error) });
    return searchShop(locale, query, page);
  }
}

/** Brings these products' index entries up to date: published ones are written, others removed. */
export async function indexProducts(ids: readonly string[]): Promise<void> {
  const config = meiliConfig();
  if (!config || ids.length === 0) return;
  const docs = (await searchFeed({ ids })).map(productDocument);
  const published = new Set(docs.map((d) => d.id));
  const gone = ids.filter((id) => !published.has(id));
  if (docs.length > 0) await meili.addDocuments(config, PRODUCT_INDEX, docs);
  if (gone.length > 0) await meili.deleteDocuments(config, PRODUCT_INDEX, gone);
}

/** Outbox handler for `search.product_changed`. Reads the product's current state, so repeats are harmless. */
export async function onProductChanged(event: OutboxEvent): Promise<void> {
  await indexProducts([event.aggregateId]);
}

/**
 * Rebuilds the index from the database into a fresh index and swaps it in,
 * so search keeps answering from the old one meanwhile and products removed
 * while the index was out of date disappear. Returns how many products were
 * indexed, or null when no search engine is set up.
 */
export async function rebuildProductIndex(): Promise<number | null> {
  const config = meiliConfig();
  if (!config) return null;
  const next = `${PRODUCT_INDEX}_rebuild`;
  if (await meili.indexExists(config, next)) await meili.waitForTask(config, await meili.deleteIndex(config, next));
  await meili.waitForTask(config, await meili.updateSettings(config, next, PRODUCT_INDEX_SETTINGS));
  let count = 0;
  let last = null;
  for (let after: string | null = null; ; ) {
    const rows = await searchFeed({ after, take: REBUILD_PAGE });
    if (rows.length === 0) break;
    last = await meili.addDocuments(config, next, rows.map(productDocument));
    count += rows.length;
    after = rows[rows.length - 1]!.id;
    if (rows.length < REBUILD_PAGE) break;
  }
  if (last) await meili.waitForTask(config, last, 10 * 60_000);
  if (!(await meili.indexExists(config, PRODUCT_INDEX))) await meili.waitForTask(config, await meili.updateSettings(config, PRODUCT_INDEX, PRODUCT_INDEX_SETTINGS));
  await meili.waitForTask(config, await meili.swapIndexes(config, PRODUCT_INDEX, next));
  await meili.waitForTask(config, await meili.deleteIndex(config, next));
  logger.info("search index rebuilt", { products: count });
  return count;
}

/** True when a search engine is set up but its product index doesn't exist yet (first start). */
export async function productIndexMissing(): Promise<boolean> {
  const config = meiliConfig();
  return config ? !(await meili.indexExists(config, PRODUCT_INDEX)) : false;
}
