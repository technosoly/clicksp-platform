---
name: ecommerce-frontend
description: Clicksp storefront UI — design tokens from the brand logo, shadcn/ui components, Server Components first, mobile-first RTL/LTR pages (home, category, product, vehicle selector, search, cart, checkout, account) built for slow networks and low-end Android phones. Use when building or changing any customer-facing page or component.
---

# E-commerce frontend

## Activation conditions
- Files under `app/[locale]/(store)/` or `src/components/store/`.
- Design tokens, theme, shared UI primitives.

## Purpose
A fast, trustworthy, specialist parts store: customers find the right part for their bike quickly, even on a weak 3G/4G connection.

## Brand and design tokens
From the uploaded logo (verify exact values from the vector file when available):
- `--brand-orange` ≈ `#DE803C` (primary action, highlights)
- `--brand-charcoal` ≈ `#272A2D` (text, header, footer)
- `--brand-cream` ≈ `#F4F1D4` (soft surfaces, badges)
- White background, neutral grays derived from charcoal.
Define as CSS variables in `app/globals.css` mapped to Tailwind theme tokens; shadcn/ui components consume tokens only. Check contrast: orange on white for large text/buttons only if ≥ 3:1; body text uses charcoal.

## Page inventory (storefront)
- Home (driven by page builder sections), category listing with filters, product detail, vehicle selector + "my garage", search results, cart, checkout (address → shipping → payment), order tracking, account (orders, addresses, vehicles, wishlist), articles.

## Workflow
1. Default to **Server Components**. Add `'use client'` only for interactive islands: cart button/drawer, search box with suggestions, filter controls, vehicle selector, image gallery, checkout steps.
2. Fetch data through module services (server) — never call internal REST APIs from Server Components.
3. Product page must show: localized title, identifiers (SKU/OEM in LTR spans), price via `formatMoney`, availability (in stock / low / out), **verified compatibility list** and a "check fit for my bike" control, warranty, specs table, documents.
4. Use `next/image` with explicit `sizes`, AVIF/WebP, lazy loading below the fold, and blur placeholders from stored metadata.
5. Motion: only for small transitions (drawer, toast); respect `prefers-reduced-motion`; import from the lightweight entry and only in client islands.
6. Forms: React Hook Form only if needed; prefer Server Actions + Zod with progressive enhancement (works without JS where feasible).

## Technical requirements
- Client JS budget: ≤ 150 KB gzip on product and category pages (checked in CI by `performance-engineering`).
- Lists paginate (cursor) and filters are URL search params (shareable, cacheable).
- Skeletons via `loading.tsx`; errors via `error.tsx` with localized messages.
- Accessibility: semantic landmarks, focus states, labels, 44 px touch targets, WCAG AA contrast.
- No hardcoded strings (messages files) and no hardcoded product data.

## Security requirements
- No secrets or internal IDs beyond what the page needs in client props.
- Never render user or admin HTML directly; use the rich text renderer from `bilingual-content`.
- Cart and checkout totals displayed from server responses only.

## Expected outputs
- Pages, components, tokens, Storybook-free visual checks via Playwright screenshots.

## Documentation references
- Next.js Server and Client Components: https://nextjs.org/docs/app/building-your-application/rendering
- shadcn/ui: https://ui.shadcn.com/docs
- Tailwind CSS: https://tailwindcss.com/docs
- Motion: https://motion.dev/docs/react
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Testing requirements
- Playwright on 360×800 (mobile) and 1280×800 in `fa` and `en`: home, category, product, search, cart, checkout up to payment redirect (using the dev-only fake gateway).
- RTL/LTR screenshot comparisons.
- Accessibility scan (axe) on key pages with zero serious violations.
- Price shown equals server total in cart and checkout tests.
