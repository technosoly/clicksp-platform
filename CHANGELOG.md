# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added (Phase 6b, part 1: storefront browsing)
- **Home** with search, motorcycle brands, top categories and the latest parts. **Category pages** (`/c/<slug>`) with sub-categories, breadcrumbs and every published part below them, 24 per page. **Product pages** (`/p/<slug>`) with photos, price (and the old price when discounted), stock as in stock / only a few left / out of stock, part numbers, warranty and the motorcycles the part is verified to fit. Ordering opens in the next part.
- **Search** (`/search`) by title, SKU or part number, whatever the separators and whether digits are Persian or English. Search pages are not indexed.
- **Motorcycles** (`/motorcycles`): brands and models; a model page lists its years and engine versions and the parts verified to fit, narrowed by year (solar or Gregorian), generation or engine version.
- Only published products (active, with a priced default variant), active categories, brands and motorcycles, public photos and verified fitment are ever shown; costs, notes and stock quantities are never sent to the shop. A Persian address opened under `/en` still finds the page; each page links its other-language address (canonical and hreflang).
- Security review fixes: a category under a switched-off parent is hidden with it; deleted categories and brands, switched-off motorcycle brands and makers, and switched-off variants (their SKUs, part numbers and photos) never show; a badly encoded address is a 404, not an error.
- Tests: unit (180 in total), integration on PostgreSQL (182 in total), E2E (52 in total, desktop and mobile).

### Added (Phase 6, part 2c: inventory)
- **Warehouses** (`/admin/warehouses`, Super and Business Admin): code, name, city, address, phone and priority; each starts with a default storage location `MAIN`, and more locations (shelves, bins) can be added, one of them the default.
- **Warehouses a Store Staff member works in**, ticked on their account screen. Staff see and move stock only there.
- **Stock** on the product screen: on hand, reserved and available per warehouse and location; receive goods (with an optional document number), issue goods (with a note), and for Super and Business Admins adjust up or down with a reason; the last 30 movements with who and when. Stock can never go below zero or below what open orders hold, even when two people record at once.
- **Inventory** (`/admin/inventory`): stock across your warehouses, searchable by SKU.
- Security review fixes: recording a movement also checks the product's categories, the inventory list shows only products in your categories, history shows names but not sign-in usernames, stocked locations and warehouses can't be switched off, and a location switched off mid-entry is refused.
- Tests: unit (180 in total), integration on PostgreSQL (177 in total), E2E (50 in total, desktop and mobile).

### Added (Phase 6, part 2b: motorcycles and fitment)
- **Motorcycles** (`/admin/motorcycles`): makers, brands, models (with type), model years (generations) and engine versions (cc, engine, cooling, fuel system, market). Model years can be typed as solar years (1398) or Gregorian (2019); they are stored Gregorian.
- **Fits these motorcycles** on the product screen: link a part to a whole generation (optionally some years) or to one engine version, with position, quantity, notes and a required source (an existing one or a new one: OEM catalogue, manufacturer document, supplier sheet, physical test, customer report). New links are unverified; Super and Business Admins verify, dispute or reject them. Store Staff link only parts in their categories and can't remove verified links.
- Security review fixes: editing a motorcycle that verified links depend on needs a verifier (Super or Business Admin), so staff can't widen years, rename or move it underneath a verified link; removing a link re-checks its status under a lock; a link to one engine version must lie within that version's years; catalog edits are audited with their previous values.
- Tests: unit (177 in total), integration on PostgreSQL (167 in total), E2E (48 in total, desktop and mobile).

### Added (Phase 6, part 2a: images)
- **Product photos** on the product screen: upload (JPEG, PNG, WebP or AVIF up to 10 MB), descriptions in Persian and English (the product name by default), order, main photo, remove. **Brand logos** and **category pictures** on their screens. Until a picture is added, a neutral placeholder is shown.
- Uploads are checked by their bytes, fully decoded with a pixel limit and re-encoded to WebP in four sizes; location data and anything else hidden in a file is dropped. Files are kept in `MEDIA_STORAGE_DIR` (a Docker volume) and served at `/media/...` only while the image is in use.
- Store Staff manage photos only for products and categories in their area; brand logos need an unscoped upload permission.
- An image file is deleted only when no row anywhere references it (every foreign key to the media table is counted, under a row lock).
- Tests: unit (172 in total), integration on PostgreSQL (159 in total), E2E (46 in total, desktop and mobile).

### Added (Phase 6, part 1: catalog)
- Admin screens for **categories** (tree with Persian and English names and addresses, motorcycle systems, switch off instead of delete), **brands**, and **products**: details in both languages, primary and extra categories, brand, warranty, variants with SKU, size and order limits, prices typed in the store's display unit (Toman by default) and stored as integer Rial, price history with who changed it, cost prices for finance roles only, OEM / manufacturer / alternative part numbers and barcodes (found whatever the separators or digits), and publish / back to draft / archive.
- **Store Staff category scopes**: on a staff member's account screen, a Business or Super Admin picks the categories they work on. A category covers everything below it; a product is in scope only when all its categories are. Staff can't create top-level categories or move categories (moving one changes what other staff can see).
- **Price approvals** (`/admin/approvals`): Store Staff propose prices; admins holding `price.update` approve or reject. An approved change is applied at once and recorded with the request; a request fails instead of overwriting a price that changed after it was made (checked by the write itself). New variants start switched off until they have a price. Staff see and can withdraw their own requests.
- Tests: unit (168 in total), integration on PostgreSQL (154 in total), E2E (46 in total, desktop and mobile).

### Fixed (Phase 6, part 1)
- Two integration tests (order status history, price history) no longer depend on the order of UUIDv7 ids created in the same millisecond.

### Added (Phase 5: administration)
- Redesigned admin panel: navigation grouped by area and filtered by permission, a dashboard listing the admin's areas, plain "coming in a later phase" pages for areas not built yet, and a 403 page for typed URLs. Mobile menu with the language switcher.
- People screens: Super Admins manage every admin, Business Admins manage Store Staff only. Create an account (it gets a one-time "set your password" link, valid 72 hours), edit details, change role, disable or enable, issue a password reset link (30 minutes), reset two-factor, sign the account out everywhere.
- Roles screens (Super Admin): create custom Business Admin or Store Staff level roles, rename or deactivate them, and edit their permissions in a matrix that respects level ceilings and only lets the actor grant what they hold.
- Audit log screen: business actions for Business Admins, every action plus security events for Super Admins.
- My account: change password (signs out other sessions, locked after 5 wrong attempts in 15 minutes), list and sign out sessions.
- Set-password page for invitation and reset links (token in the URL fragment, single use, 20 wrong links per IP per 15 minutes), and a "forgot password" page that explains who can issue a link.
- `pnpm admin:reset-link <username> [--reset-mfa]`: server-side recovery link for any admin, including the last Super Admin.
- Strict nonce-based Content Security Policy on admin, account and login pages; a static policy elsewhere.
- Escalation guards: nobody manages their own account or a role they hold, Business Admins never touch levels 1-2, an account can be given only a role whose permissions the actor holds, and every change needs a fresh two-factor check (reads do not).
- Tests: unit (156 in total), integration on PostgreSQL (141 in total), E2E (42 in total, desktop and mobile).

### Fixed (Phase 5)
- From the independent security review: unused password links are retired when the account's role changes or it is disabled (a staff invite could otherwise be used after a promotion), an account can be given only a role whose permissions the assigning admin holds, and an account can be changed (password link, two-factor reset, role, status) only by an admin who holds every permission it has, and the business audit filter for store settings is anchored.
- Customer SMS sign-in refuses phone numbers that belong to admin accounts.
- The price-history integration test no longer depends on the order of UUIDv7 ids created in the same millisecond.

### Added (Phase 4: authentication and permissions)
- Admin sign-in at `/fa/admin/login` and `/en/admin/login`: username or email + password (Argon2id), then two-factor sign-in with an authenticator app (TOTP). First sign-in shows a QR code and 10 one-time backup codes. Mandatory for Super Admin, Business Admin and Staff with price or money permissions.
- Minimal admin panel at `/admin`: dashboard with the signed-in admin's role and two-factor status, permission-filtered navigation, sign-out. Pages are never indexed.
- `pnpm admin:create-super`: creates the first Super Admin from the server command line (refuses when one exists).
- Customer sign-in at `/login` with an Iranian mobile number and a 6-digit SMS code, creating the customer account on first sign-in; minimal `/account` page with sign-out. Pluggable SMS adapter (`none` by default, `console` for development only); no real provider yet.
- Sessions: hashed tokens, separate admin and customer cookies, rotation after two-factor, 30-minute idle and 12-hour absolute admin limits, revocation at logout or when the admin role is removed.
- `authorize(actor, permission, resource)`: deny-by-default permission engine with category/warehouse scopes, step-up two-factor for sensitive permissions, and a security event for every denial.
- Rate limits for admin sign-in, two-factor codes and SMS codes; login attempts, security events and audit log rows for sign-in, sign-out, enrolment and registration.
- `src/lib/security` (tokens, Argon2id, TOTP, AES-256-GCM), `src/lib/http` (client IP and request id), `AUTH_SECRET` setting.
- Tests: unit (117 in total), integration on PostgreSQL (120 in total, including every permission × every admin level, parallel two-factor guessing and enrolment races), E2E (26 in total, desktop and mobile).
- Fixes from the independent security review: one trusted client-IP header with a shared bucket for unknown IPs, atomic two-factor attempt reservation, per-IP and global SMS-code limits, per-account-and-IP login limits, `__Host-` Secure cookies in production, conditional enrolment, previous session revoked at sign-in, CLI refuses when any Super Admin exists, AES-GCM tag length pinned.
- ADR 0002: own authentication code instead of Better Auth; login and SMS rate limits counted in PostgreSQL.

### Fixed (Phase 4)
- An empty optional variable copied from `.env.example` (for example `S3_ENDPOINT=`) made the server environment invalid; empty values now mean "not set".

### Changed (Phase 4)
- Store header has a "My account" link.
- Three integration tests (audit chain, system roles, movement ledger order) no longer assume the database holds only their own rows or that rows written in the same millisecond are ordered.

### Added (Phase 3: database)
- Full PostgreSQL schema in `prisma/schema/` (137 tables, one file per area): identity, RBAC and audit; catalog (products, variants, prices, attributes, images, documents, OEM and part-number identifiers, relations); motorcycle catalog (manufacturer, make, model, generation, variant, specifications) and verifiable fitment with sources; multi-warehouse inventory; carts, wishlists, orders, returns, refunds, coupons, invoices; payments; double-entry accounting and reconciliation; shipping; content and page builder; system settings, SEO, feature flags, releases and deployments, jobs, imports and exports, outbox, idempotency keys, notifications.
- UUIDv7 primary keys generated by the database (`gen_uuid_v7()`), integer Rial `BIGINT` money with a currency code beside every amount group, per-locale translation tables and slugs.
- SQL integrity rules with integration tests: append-only ledgers, hash-chained audit log with `audit_logs_verify()`, RBAC level ceilings and last-Super-Admin guard, ledger-driven oversell-proof inventory balances and reservations, order state machine with automatic status history, order total checks at commit, frozen order amounts and line snapshots, refund and return limits, immutable final payments and issued invoices, balanced and immutable posted journals with reversals, non-overlapping periods, fitment year and verification rules, category cycle guard, media and link allow-lists.
- Permission catalogue (65 keys) with level ceilings, scopes, MFA flags and default bundles for Super Admin, Business Admin and Store Staff (`src/modules/rbac/domain/permission-catalogue.ts`); required settings with safe defaults (`src/modules/settings/domain/default-settings.ts`).
- Idempotent system seed (`pnpm db:seed`, also run by the Docker migrate job): fa/en locales, IRR, permissions, four system roles, settings. No business data.
- `pnpm test:integration` (82 tests on a real PostgreSQL database, including concurrent-checkout and concurrent-posting tests) and `pnpm db:drift`; both run in CI.
- Security hardening from the independent review (`20261126100300_security_hardening`): immutable permission keys, journal and period row locks, TRUNCATE refused on ledgers and logs, approval state rules, paid orders need a matching succeeded payment, no refunds before payment, stricter relative-link checks, expiring Super Admin grants don't count as the last one.
- Docs: `DATABASE.md`, `ERD.md`, `RBAC.md`, `ACCOUNTING.md` (with the professional-review disclaimer), `SECURITY.md` (including the PII inventory).

### Changed (Phase 3)
- Prisma schema moved from `prisma/schema.prisma` to the multi-file folder `prisma/schema/`; the `partialIndexes` preview feature is enabled.
- Node.js 22.18+ is required (the seed runs TypeScript with Node's built-in type stripping).

### Added (Phase 2: project foundation)
- Claude Code project configuration: `.claude/CLAUDE.md`, 15 project skills, 11 agents, and `pnpm skills:validate`.
- Next.js 16 App Router app with TypeScript strict mode, standalone output and baseline security headers.
- Persian-first localization with next-intl: `/fa` (default, RTL) and `/en` (LTR), language switcher, hreflang alternates, localized not-found page, Jalali/Gregorian date helper.
- Design system foundation: Tailwind CSS 4 tokens from the logo palette, shadcn/ui configuration and Button component, self-hosted Vazirmatn variable font.
- Placeholder home page ("store opening soon") with the brand logo; no products or business data.
- `src/lib/money`: central Rial/Toman currency service (bigint Rial, Toman display, Persian/English digits, separators, rounding modes, percent discounts, exact allocation, input parsing).
- `src/lib/persian-text`: Persian/Arabic letter, digit, half-space and identifier normalization.
- Pure domain helpers with tests: order totals and refund limits (`sales`), balanced journal entries and reversals (`accounting`).
- `src/lib/env` (Zod-validated server environment), `src/lib/db` (Prisma 7 client with the pg driver adapter), `src/lib/logger` (JSON logs).
- Prisma 7 configuration and a baseline migration enabling `pg_trgm`.
- `/api/health` (liveness) and `/api/ready` (database readiness) endpoints.
- Dockerfile (multi-stage, non-root, health check, optional npm mirror and CA for restricted networks) and Docker Compose for PostgreSQL 17, Redis 7, Meilisearch, migrations and the app.
- `.env.example`, GitHub Actions CI (lint, typecheck, unit, migrations, build, E2E, Docker build) and Dependabot.
- Vitest unit tests and Playwright E2E tests (desktop and mobile).
