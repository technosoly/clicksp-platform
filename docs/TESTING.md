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
| `src/modules/rbac/tests` | Permission catalogue: key format, level ceilings, Staff and Business Admin defaults and restrictions, scoped grants; `decide()` deny-by-default, scopes, merged roles, every permission × each admin level |
| `src/lib/security/tests` | Tokens, RFC 4226/6238 TOTP vectors, drift window, replay refusal, clock-drift diagnosis, base32, AES-GCM tamper/key/context checks, Argon2id hashing and password policy |
| `src/lib/http/tests` | Client IP and request id parsing, rejection of invalid values |
| `src/modules/identity/tests` | Iranian mobile normalization (Persian/Arabic digits, +98/0098/0 forms), MFA requirement rules, session idle/absolute lifetimes, SMS adapters (console refused in production; Kavenegar request format, receptor conversion, success and error answers, timeout, bad numbers and codes refused before any request, API key never in errors, missing key or template refused) |
| `src/modules/audit/tests` | Secret redaction in audit rows |
| `src/modules/rbac/tests/escalation.test.ts` | Who may manage which admin level, role-level editing, granting only held permissions (`.propose` covered by its base key), assigning only roles whose grants the actor holds, grant diffs |
| `src/modules/identity/tests/admin-account.test.ts` | Account form validation (username normalization, digits), password-link lifetimes and paths, audit action names, safe return paths after two-factor |
| `src/lib/security/tests/csp.test.ts` | Which paths get the strict nonce CSP, nonce format, policy directives in development and production |
| `src/modules/catalog/tests/catalog-input.test.ts` | Slugs from Persian and English names, bilingual category and product input, SKU normalization, prices typed in Toman or Rial with Persian digits to integer Rial, part number and barcode rules, publish requirements |
| `src/components/admin/admin-nav.test.ts` | Navigation per admin level, empty groups dropped, upcoming sections |

## End-to-end tests (Playwright)
`pnpm build && pnpm test:e2e` starts the standalone server and runs `e2e/` on a desktop and a mobile (Pixel 5) profile: `/` → `/fa`, RTL/LTR and `lang`, language switching, hreflang, localized 404, no horizontal overflow, `/api/health`, security headers; admin sign-in (redirect when signed out, generic error, TOTP enrolment with QR and manual key, backup codes, dashboard, HttpOnly + SameSite=Strict cookie, sign-out, TOTP challenge with a backup code), customer sign-in unavailable without SMS provider, account page redirect.

The server and the admin E2E test need `DATABASE_URL` (migrated and seeded) and `AUTH_SECRET`; the test creates its own synthetic `test-e2e-*` Business Admin.

`e2e/admin-management.spec.ts` covers navigation and 403 pages per admin level, inviting a staff member and setting the password from the one-time link (works once), disabling an account, the two-factor step-up before a change, changing one's own password, an invalid link, the role permission editor and the nonce CSP on admin pages. It creates its own synthetic accounts; run it on a freshly migrated and seeded database, because failed sign-ins from earlier runs count toward the shared rate limit.

`e2e/catalog.spec.ts` covers a Business Admin creating a category, a brand and a product, pricing it in Toman, publishing it and finding it by part number, and a Store Staff member limited to one category proposing a price that a Business Admin approves.

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
| `auth.test.ts` | First Super Admin CLI (validation, hashed password, audit row, refuses a second); admin password sign-in (generic failures, attempts recorded, case/space-insensitive identifier, disabled and non-admin users, per-account and per-IP rate limits, only token hashes stored); TOTP enrolment, encrypted secret, session rotation, challenge, replay refusal, single-use backup codes, clock drift refused and recorded (not for replays), new backup codes (current app code only, shared lock, old codes retired, audited; refused without two-factor, for customers and admins without an enrolment), lockout and unlock; idle and absolute session limits, logout, role removal and disabled users; customer SMS sign-in (no provider, invalid numbers, keyed code hash, signup with customer role, reuse refused, 5 tries, 3-minute expiry, newest code only, send limits per number and IP, disabled customers, admin/customer session separation); `authorize()` for **every permission × Super Admin, Business Admin, Store Staff** with scopes, denial security events, step-up MFA, customers and expired assignments |
| `seed.test.ts` | No business data after seeding; locales and IRR; every catalogue permission with ceiling, scope and MFA flag; default bundles; Staff has no financial/settings/role permissions; Business Admin has no Super Admin-only permission; settings; idempotency without overwriting admin changes |
| `rbac-audit.test.ts` | Level ceiling for system and custom roles, customer roles, scoped grants, system role protection, last Super Admin guard, user delete and identifier checks, hashed session tokens, approval rules, immutable permission keys, TRUNCATE refusal, audit hash chain, tamper detection, append-only security logs |
| `catalog-fitment.test.ts` | SKU uniqueness with soft delete, single default variant, price checks, BIGINT above 2^53, price history with actor, identifier normalization and barcode uniqueness, category cycles and depth, attribute types, variant ownership, generation/variant years, product ↔ motorcycle many-to-many, one target and required source, verification rules, index use for fitment lookups |
| `inventory.test.ts` | Every movement type, no negative stock, no direct balance writes, append-only ledger, warehouse/location match, transfers, reservations (over-reserve, release once, consume then sell), **12 concurrent checkouts for 5 units sell exactly 5** |
| `sales-payments.test.ts` | Order totals at commit, formulas, state machine with history and actor, paid only with a matching succeeded payment, no refunds before payment, frozen amounts and lines, snapshots, refund cap and idempotency key, return quantity cap, coupons, addresses, invoice immutability, one successful payment per order, unique gateway references, immutable final payments |
| `admin-management.test.ts` | Who manages which accounts (every level, denied cases recorded), self-management refused, step-up for changes but not reads, invitation and reset links (hash only, single use, expiry, earlier links retired, retired on promotion and disable, per-IP limit, sessions signed out), assigning only roles whose permissions the actor holds, session revocation on role change, disable and two-factor reset, the recovery CLI, own password change and its lockout, roles and permission matrix guards, the audit view per level, admin phone numbers never get a customer session |
| `catalog-admin.test.ts` | Categories (tree, scoped Staff only below their categories, no top level, no moving out, cycles, slugs), brands, products per level (create, edit, scope of every category, listing filtered by scope, archive only for Business Admins), prices (Toman input to Rial, history with actor, compare-at rules), price requests (one open per variant, Staff can't approve, approval applies with the request recorded, stale request fails, reject, withdraw, expiry, nobody decides their own), variants and part numbers (normalized, unique), cost prices for finance roles only, Store Staff category scopes (only within the assigning admin's own coverage) |
| `accounting-content.test.ts` | Balanced posting, no entries slipping into a journal being posted (two connections), unbalanced and one-line refusals, one-sided lines, posted immutability, reversals net to zero and only once, draft-first flow, closed periods, dates outside period, overlapping periods, idempotent source key, postable accounts and account tree, page revision immutability, media and link allow-lists, UUIDv7 format |
