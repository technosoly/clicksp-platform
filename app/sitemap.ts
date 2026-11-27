import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { cachedSitemapUrls } from "@/modules/content/service/sitemap";

// Read at request time (the database isn't there at build time); cached for an hour in the service.
export const dynamic = "force-dynamic";

/** The public pages, once the owner opens the store to search engines (SITE_INDEXING); empty before. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { SITE_INDEXING, APP_URL } = env();
  return SITE_INDEXING ? cachedSitemapUrls(APP_URL) : [];
}
