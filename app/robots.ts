import type { MetadataRoute } from "next";

// Phase 2: the store is not open yet, so crawlers are asked not to index it.
// Phase 6b replaces this with the production robots rules and sitemap.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
