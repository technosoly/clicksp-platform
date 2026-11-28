import "server-only";
import { catalogSitemap } from "@/modules/catalog/service/storefront";
import { motorcycleSitemap } from "@/modules/vehicles/service/shop";
import { articleSitemap } from "./articles";
import { shopInfoPageLinks } from "./info-pages";

/** One sitemap holds at most 50,000 addresses; each kind is capped well below. */
const LIMIT = 10_000;
const MAX = 45_000;
const TTL_MS = 60 * 60 * 1000;

export type SitemapUrl = { url: string; lastModified?: Date };

/**
 * The public pages search engines may list: home, motorcycles, articles,
 * information pages, categories, products and motorcycle models, in each
 * language that has its own address. Nothing behind a sign-in, nothing
 * hidden in the shop. Public data only, so no actor.
 */
export async function sitemapUrls(baseUrl: string): Promise<SitemapUrl[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const [catalog, articles, bikes, faPages, enPages] = await Promise.all([catalogSitemap(LIMIT), articleSitemap(LIMIT), motorcycleSitemap(), shopInfoPageLinks("fa"), shopInfoPageLinks("en")]);
  const url = (locale: string, path: string) => `${base}/${locale}${path === "/" ? "" : encodeURI(path)}`;
  const fixed = (["fa", "en"] as const).flatMap((l) => ["/", "/motorcycles", "/blog", "/about", "/contact"].map((p) => ({ url: url(l, p) })));
  // About and Contact have their own addresses (in fixed); /pages/about and /pages/contact redirect there.
  const own = (p: { key: string }) => p.key !== "about" && p.key !== "contact";
  const pages = [...faPages.filter(own).map((p) => ({ url: url("fa", `/pages/${p.key}`) })), ...enPages.filter((p) => own(p) && p.lang === "en").map((p) => ({ url: url("en", `/pages/${p.key}`) }))];
  const rest = [...catalog, ...articles, ...bikes].slice(0, MAX).map((e) => ({ url: url(e.locale, e.path), ...(e.updatedAt ? { lastModified: e.updatedAt } : {}) }));
  return [...fixed, ...pages, ...rest];
}

let cached: { at: number; base: string; urls: SitemapUrl[] } | null = null;

/** sitemapUrls, rebuilt at most once an hour per server process (the sitemap is public and unauthenticated). */
export async function cachedSitemapUrls(baseUrl: string, now = Date.now()): Promise<SitemapUrl[]> {
  if (cached && cached.base === baseUrl && now - cached.at < TTL_MS) return cached.urls;
  const urls = await sitemapUrls(baseUrl);
  cached = { at: now, base: baseUrl, urls };
  return urls;
}
