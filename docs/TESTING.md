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

## End-to-end tests (Playwright)
`pnpm build && pnpm test:e2e` starts the standalone server and runs `e2e/` on a desktop and a mobile (Pixel 5) profile: `/` → `/fa`, RTL/LTR and `lang`, language switching, hreflang, localized 404, no horizontal overflow, `/api/health`, security headers.

To use an already installed Chromium instead of Playwright's download, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## CI
`.github/workflows/ci.yml` runs on every pull request: skills validation, lint, typecheck, unit tests, migrations against an empty PostgreSQL 17, production build, E2E, and a Docker image build.

## Integration tests against PostgreSQL
Planned from Phase 3, when there is schema to test (constraints, triggers, concurrency).
