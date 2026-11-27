# Architecture

This document describes what is implemented today (Phase 3). Target architecture and rules for later phases live in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and the skills under `.claude/skills/`.

## Shape

A **modular monolith**: one Next.js application, one PostgreSQL database, business code split into modules under `src/modules/<module>/` with `domain/`, `service/`, `repo/`, `api/` and `tests/` layers. Only `repo/` (and `src/lib/db`) may import the Prisma client; ESLint enforces this with `no-restricted-imports`.

Implemented so far:

| Path | Purpose |
|---|---|
| `app/[locale]/layout.tsx` | Root layout per locale: `<html lang dir>`, metadata, hreflang, fonts, skip link |
| `app/[locale]/(store)/` | Storefront group: header, footer, placeholder home page |
| `app/[locale]/not-found.tsx`, `[...rest]` | Localized 404 |
| `app/api/health`, `app/api/ready` | Liveness and database readiness |
| `proxy.ts` | next-intl locale routing (Next.js 16 "proxy", formerly middleware) |
| `src/lib/i18n` | Locales, routing, navigation helpers, request config, date formatting |
| `src/lib/money` | The only place money is converted, rounded or formatted |
| `src/lib/persian-text` | The only place Persian text is normalized |
| `src/lib/env` | Zod-validated, server-only environment |
| `src/lib/db` | Prisma client (pg driver adapter), connection ping |
| `src/lib/logger` | Structured JSON logging |
| `src/modules/sales/domain/totals.ts` | Pure order total and refund-limit calculation |
| `src/modules/accounting/domain/journal.ts` | Pure double-entry balance and reversal rules |
| `src/modules/rbac/domain/permission-catalogue.ts` | Permission keys, level ceilings and default bundles of the three admin levels |
| `src/modules/settings/domain/default-settings.ts` | Required settings with safe defaults |
| `src/modules/identity` | Admin password + TOTP sign-in, customer SMS-code sign-in, sessions, SMS adapter, cookie and guard glue (`api/`) |
| `src/modules/rbac/service/authorize.ts` | The `authorize()` gate every service calls; pure decision logic in `rbac/domain/authorize.ts` |
| `src/modules/catalog` | Categories, brands, products, variants, prices, part numbers and price approvals (Phase 6): input rules in `domain/`, Prisma in `repo/`, authorization and audit in `service/`, Server Actions in `api/` |
| `app/[locale]/(store)` | Storefront (Phase 6b): home, category (`/c/<slug>`), product (`/p/<slug>`), search, motorcycles and the parts that fit a model, all reading the public services in `catalog/service/storefront.ts`, `vehicles/service/shop.ts` and `compatibility/service/shop-fitment.ts` |
| `src/modules/sales` | Cart (Phase 6b part 2) and checkout (part 3): rules in `domain/`, Prisma in `repo/cart-repo.ts` and `repo/order-repo.ts`, services in `service/cart.ts` and `service/checkout.ts`, cookie and Server Action glue in `api/` |
| `src/modules/shipping` | Provinces (ISO 3166-2:IR), shipping zones, methods and rates (admin service, `shipping.configure`) and the public quote used at checkout (when several of a method's rates fit a parcel, the one with the lowest starting weight is used) |
| `src/modules/settings/service/catalog-settings.ts` | Store display unit (Toman or Rial) and approval lifetime, validated with safe defaults |
| `src/modules/audit` | Audit log and security event writers (secrets redacted) |
| `src/lib/security` | Random tokens, Argon2id, TOTP, AES-256-GCM |
| `app/[locale]/admin` | Admin sign-in, two-factor steps and the admin panel shell |
| `scripts/admin-create-super.ts` | First Super Admin CLI |
| `prisma/schema/` | Full database schema (137 tables), one file per area; see [DATABASE.md](DATABASE.md) and [ERD.md](ERD.md) |
| `prisma/migrations/` | Generated schema migration plus hand-written SQL for constraints and triggers |
| `prisma/seed.ts` | Idempotent system seed (locales, IRR, permissions, roles, settings; no business data) |

## Key decisions

| Decision | Why |
|---|---|
| Next.js 16 App Router, Server Components first | Small client bundles for slow mobile networks; client components are only the language switcher and the sign-in forms. |
| Pages are statically generated per locale | `setRequestLocale` in every layout/page lets `/fa` and `/en` prerender (verified in the build output). |
| next-intl with `localePrefix: "always"`, `localeDetection: false` | Every URL carries its language (clean hreflang and caching). `/` always opens Persian, the store's default, regardless of browser language. |
| TypeScript 6.0 rather than 7.0 | TypeScript 7 (native compiler) is newer than the support range of typescript-eslint and Next.js tooling at the time of writing. |
| Prisma 7.10 (stable), not 8.0 RC | npm's `latest` tag currently points at a release candidate; we pin the last stable major. Prisma 7 needs a driver adapter (`@prisma/adapter-pg`) and `prisma.config.ts`. |
| Money as `bigint` Rial | No floats, no overflow at 2^53. Toman is display only. See [ADR 0001](adr/0001-money-representation.md). |
| Integrity rules in the database, not only in code | Triggers and CHECKs enforce append-only ledgers, balanced posted journals, oversell-proof stock, the order state machine, refund limits, fitment verification and RBAC level ceilings, so a bug or a raw SQL write cannot break them. Each rule has an integration test. |
| Inventory balances driven by the movement ledger | Balances change only inside triggers on `inventory_movements` and `stock_reservations`; the row lock taken by the UPDATE serializes concurrent checkouts. |
| UUIDv7 keys from a SQL function | Time-ordered keys without a PostgreSQL 18 dependency; raw SQL inserts get keys too. |
| Prisma multi-file schema + `partialIndexes` preview | One file per area keeps the 137-table schema readable; partial unique indexes (soft-delete-aware uniqueness) are declared in Prisma so `pnpm db:drift` stays empty. |
| System seed with node-postgres, not the Prisma client | Runs under plain Node (type stripping) in the migrate container; never overwrites admin changes. |
| Vazirmatn self-hosted via `@fontsource-variable/vazirmatn` | Fonts are bundled into the build with unicode-range subsets; no Google Fonts (unreliable from Iran). |
| Tailwind CSS 4 with CSS-variable tokens | Brand palette from the logo (orange `#DE803C`, charcoal `#272A2D`, cream `#F4F1D4`) in one place; shadcn/ui reads the same token names. Layout uses logical properties (`ms-`, `start-`) for RTL/LTR. |
| Security headers in `next.config.ts`, CSP in `proxy.ts` | `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, HSTS. Content-Security-Policy with a per-request nonce on the (dynamic) admin, sign-in and account pages; a static policy on the pre-rendered storefront ([SECURITY.md](SECURITY.md)). |
| Admin pages: service call → 403 | Pages call a service through `adminPage()`, which turns `AuthzError` into Next.js `forbidden()` (HTTP 403, `forbidden.tsx`) and `MfaRequiredError` into the two-factor page. Admin Server Actions go through `runAdminAction()`, which resolves the actor from the cookie and maps the same errors to form messages. |
| Own authentication code, rate limits in PostgreSQL | Hashed tokens and codes, separate admin/customer realms and audit-in-transaction fit the Phase 3 schema better than adapting Better Auth. See [ADR 0002](adr/0002-own-authentication.md). |
| Sign-in through Server Actions | Same-origin checks by Next.js (CSRF), no client-side token handling, works with JS disabled-ish forms; admin pages render per request (`force-dynamic`), storefront pages render per request. |
| Images re-encoded on upload, stored on disk, served by the app | Uploads are checked by their bytes, decoded with `sharp` under a pixel limit, and re-encoded to WebP at 320/640/1200/2000 px (never enlarged). Only the re-encoded files are kept, so EXIF/GPS data and anything hidden in a file never reach the shop. Files live behind an `ObjectStorage` interface (local disk now, S3 later); `app/media/[...key]` serves only keys of public, ready, not deleted images, with `nosniff` and a sandbox CSP. Without a photo, the shop shows a neutral placeholder. |
| Public storefront reads take no actor | The one exception to "every service authorizes an actor": storefront reads return only what any visitor may see (published products with an active priced default variant, active categories, brands and motorcycles, public ready images, verified fitment, stock as in stock / low / out) and select only customer-facing fields, never costs, notes, audit data or quantities. The visibility rules live in one place per module (`PUBLISHED` in `catalog/repo/storefront-repo.ts`). Anything that writes or shows a customer's own data takes an actor. |
| A cart belongs to whoever holds it | Cart services take a `CartOwner` resolved on the server from the customer session cookie or the guest cart cookie (`sales/api/cart-owner.ts`), never from the request body, so no permission key applies. The guest cookie holds a random 256-bit token; the database stores only its SHA-256. A cart stores variant ids and quantities only; prices, order limits and stock are read at every view. |
| Placing an order is one transaction | The customer's cart row is locked, compared with what was priced, the order and its line snapshots are inserted, stock is reserved from balance rows locked in a fixed order (the reservation trigger refuses more than is available), the cart is marked converted and an `order.placed` outbox event is written. The database checks the order's totals at commit. |
| Storefront pages render per request | Prices, stock and publish status change from the admin at any time; pages are `force-dynamic` until cache revalidation on admin writes is added. |
| `robots.txt` disallows everything | The store is not open; Phase 6b ships the real robots rules and sitemap. |

## Not implemented yet

Business services and screens for orders, accounting, payments, shipping and content; an S3 storage adapter; page builder. The catalog screens (Phase 6, part 1) product photos, brand logos and category pictures (part 2a), the motorcycle catalog with fitment links (part 2b), warehouses with manual stock movements (part 2c, `src/modules/inventory`), stock transfers between warehouses and stock counts (`inventory/service/transfers.ts`, `counts.ts`) and storefront browsing (Phase 6b part 1: home, categories, products, search, motorcycles and fitment) exist. The cart, checkout, admin order screens and customer account (Phase 6b parts 2 to 5) exist. Online payment (part 6, `src/modules/payments`) works through a gateway adapter contract; only a test gateway exists until a real provider is connected with the store's credentials. Payments calls orders only through `sales/service/order-payment.ts`. Returns and manual refunds (`sales/service/returns.ts`) put returned goods back on sale through `inventory/service/stock.ts` (`restockReturn`) and write refunds to the outbox for accounting. The store's information pages (`src/modules/content`) are kept as page revisions in the page builder's document shape, edited as plain text and rendered as structured blocks. Background jobs run in the app process with pg-boss (`src/modules/jobs`, started from `instrumentation.ts` rather than a separate `worker/` process, so the single-server deployment has one Node.js service; see ADR 0003); they deliver outbox events to module handlers and expire unpaid orders. Product search (`src/modules/search`) uses Meilisearch when it is set up and the database otherwise; the index follows the outbox. Product import from CSV (`catalog/service/product-import.ts`) checks a file in a background job and, once an admin confirms, applies it through the ordinary product services as that admin (`identity/service/admin-auth.ts` `backgroundAdminActor`, permissions loaded at run time). The database tables for the rest exist (Phase 3); the admin navigation lists their areas as "Coming soon". See [ROADMAP.md](ROADMAP.md).
