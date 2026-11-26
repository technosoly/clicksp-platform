---
name: ecommerce-seo
description: Bilingual technical SEO for Clicksp — generateMetadata, canonical URLs, hreflang, XML sitemaps, robots.txt, Product/Offer/Breadcrumb/Article structured data, Open Graph, clean localized URLs, category/product/article SEO fields and internal linking. Use when building pages that should be indexed, changing URLs or slugs, or editing SEO fields.
---

# E-commerce SEO

## Activation conditions
- New indexable route, URL/slug change, `generateMetadata`, sitemap, robots, structured data, `seo_metadata` admin fields.

## Purpose
Every indexable page has correct, localized metadata and structured data, and search engines (Google, and in Iran also local engines) see one canonical URL per language.

## URL scheme
- `/{locale}/c/{category-slug}` — category
- `/{locale}/p/{product-slug}-{shortId}` — product (shortId keeps URLs stable if the slug changes; old slugs 301 to current)
- `/{locale}/m/{manufacturer}/{model}/{generation?}` — motorcycle landing pages (parts for this bike)
- `/{locale}/blog/{article-slug}`
- Lowercase, hyphenated; Persian slugs allowed (percent-encoded) or transliterated per store setting.

## Workflow
1. Implement `generateMetadata` per route using `seo_metadata` overrides, falling back to generated title/description from translations (title ≤ 60 chars, description ≤ 160).
2. `alternates.canonical` = self URL for the locale; `alternates.languages` = `fa-IR`, `en`, `x-default` (→ fa) **only for locales that actually have a translation** (see `bilingual-content` fallback rule).
3. Structured data via `<script type="application/ld+json">` produced from typed builders in `src/lib/seo/jsonld.ts`:
   - Product: name, sku, mpn (manufacturer PN), gtin (barcode when valid), brand, image, offers (price in **IRR**, availability, priceValidUntil optional), `isAccessoryOrSparePartFor` for verified compatible models.
   - BreadcrumbList on category/product/article.
   - Article for blog posts; Organization + WebSite with SearchAction on home.
4. `app/sitemap.ts` → sitemap index split by type and paginated (≤ 50k URLs per file), generated from published, non-deleted records; `lastModified` from `updated_at`.
5. `app/robots.ts`: disallow `/admin`, `/api`, `/preview`, cart/checkout/account, search result pages with filters; point to sitemap.
6. Open Graph / Twitter images: product main image; fallback brand image; dynamic OG image route optional.
7. Internal linking: breadcrumbs, related/replacement products, "parts for this motorcycle" links, category descriptions.

## Technical requirements
- Filtered/sorted listing URLs: `noindex, follow` except whitelisted filter combinations (e.g., category + motorcycle model) which get canonical self URLs.
- Out-of-stock products stay indexable with `availability: OutOfStock`; archived products 410 or 301 to replacement.
- JSON-LD escaped safely (`JSON.stringify` + `<` replacement) to prevent script injection.

## Security requirements
- SEO fields edited in admin are plain text, length-limited, never HTML.
- Preview and admin routes always `noindex` and blocked in robots.

## Expected outputs
- Metadata functions, JSON-LD builders, sitemap/robots routes, admin SEO fields with live length counters.

## Documentation references
- Next.js Metadata API: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- Next.js sitemap: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Google Product structured data: https://developers.google.com/search/docs/appearance/structured-data/product
- hreflang: https://developers.google.com/search/docs/specialty/international/localized-versions
- Schema.org Product: https://schema.org/Product

## Testing requirements
- Unit tests for JSON-LD builders (valid shape, IRR currency, escaping).
- Route tests: canonical and hreflang present and correct for both locales; missing translation omits alternate.
- Sitemap contains only published records; robots disallows admin/api/preview.
- Playwright: product page head contains title, description, canonical, og:image, valid JSON-LD.
