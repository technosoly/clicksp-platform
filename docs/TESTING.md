# Testing

## Unit tests (Vitest)
`pnpm test` runs `src/**/*.test.ts` and `tests/**/*.test.ts` in Node.

| Suite | Covers |
|---|---|
| `src/lib/money/tests` | Rial↔Toman, formatting in Persian/English digits and both units, separators, values above 2^53, negatives, input parsing, rounding modes, percent and fixed discounts, allocation |
| `src/lib/persian-text/tests` | Yeh/Kaf mapping, diacritics, digits, half-space variants, storage form, identifier normalization |
| `src/lib/env/tests` | Environment validation, defaults, no secret values in errors |
| `src/modules/sales/tests` | Order totals (line and order discounts, shipping, free-shipping threshold, tax rounding), refund limits |
| `src/modules/accounting/tests` | Balanced entries, invalid lines, reversals |
| `src/modules/rbac/tests` | Permission catalogue: key format, level ceilings, Staff and Business Admin defaults and restrictions, scoped grants |

## End-to-end tests (Playwright)
`pnpm build && pnpm test:e2e` starts the standalone server and runs `e2e/` on a desktop and a mobile (Pixel 5) profile: `/` → `/fa`, RTL/LTR and `lang`, language switching, hreflang, localized 404, no horizontal overflow, `/api/health`, security headers.

To use an already installed Chromium instead of Playwright's download, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## CI
`.github/workflows/ci.yml` runs on every pull request: skills validation, lint, typecheck, unit tests, migrations against an empty PostgreSQL 17, a drift check (`pnpm db:drift`), the seed twice, integration tests, production build, E2E, and a Docker image build.

## Integration tests against PostgreSQL
`pnpm test:integration` (config `vitest.integration.config.ts`) needs `TEST_DATABASE_URL` pointing at a **disposable** database. Global setup drops and recreates its `public` schema, applies every migration with `prisma migrate deploy`, runs the system seed and records row counts of all business tables. Each test runs in a transaction that is rolled back; deferred constraint triggers are fired with `SET CONSTRAINTS ALL IMMEDIATE`. Fixtures are synthetic (`TEST-...`) and created inside the tests.

```bash
createdb clicksp_test
TEST_DATABASE_URL=postgresql://clicksp:<password>@localhost:5432/clicksp_test pnpm test:integration
```

| Suite | Covers |
|---|---|
| `seed.test.ts` | No business data after seeding; locales and IRR; every catalogue permission with ceiling, scope and MFA flag; default bundles; Staff has no financial/settings/role permissions; Business Admin has no Super Admin-only permission; settings; idempotency without overwriting admin changes |
| `rbac-audit.test.ts` | Level ceiling for system and custom roles, customer roles, scoped grants, system role protection, last Super Admin guard, user delete and identifier checks, hashed session tokens, approvals, audit hash chain, tamper detection, append-only security logs |
| `catalog-fitment.test.ts` | SKU uniqueness with soft delete, single default variant, price checks, BIGINT above 2^53, price history with actor, identifier normalization and barcode uniqueness, category cycles and depth, attribute types, variant ownership, generation/variant years, product ↔ motorcycle many-to-many, one target and required source, verification rules, index use for fitment lookups |
| `inventory.test.ts` | Every movement type, no negative stock, no direct balance writes, append-only ledger, warehouse/location match, transfers, reservations (over-reserve, release once, consume then sell), **12 concurrent checkouts for 5 units sell exactly 5** |
| `sales-payments.test.ts` | Order totals at commit, formulas, state machine with history and actor, frozen amounts and lines, snapshots, refund cap and idempotency key, return quantity cap, coupons, addresses, invoice immutability, one successful payment per order, unique gateway references, immutable final payments |
| `accounting-content.test.ts` | Balanced posting, unbalanced and one-line refusals, one-sided lines, posted immutability, reversals net to zero and only once, draft-first flow, closed periods, dates outside period, overlapping periods, idempotent source key, postable accounts and account tree, page revision immutability, media and link allow-lists, UUIDv7 format |
