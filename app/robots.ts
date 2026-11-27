import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// Read at request time, so the same build serves staging (closed) and production (open).
export const dynamic = "force-dynamic";

/**
 * Search engines are kept out until the owner opens the store
 * (SITE_INDEXING=true). Then they may list the storefront but not the admin
 * panel, the page builder preview, the account, cart, checkout, sign-in,
 * search results or the API.
 */
export default function robots(): MetadataRoute.Robots {
  const { SITE_INDEXING, APP_URL } = env();
  if (!SITE_INDEXING) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const closed = ["admin", "preview", "account", "cart", "checkout", "login", "search"].flatMap((p) => [`/fa/${p}`, `/en/${p}`]);
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...closed, "/api/"] }],
    sitemap: `${APP_URL.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
