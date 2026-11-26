# Architecture

This document describes what is implemented today (Phase 2). Target architecture and rules for later phases live in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and the skills under `.claude/skills/`.

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

## Key decisions

| Decision | Why |
|---|---|
| Next.js 16 App Router, Server Components first | Small client bundles for slow mobile networks; the only client component today is the language switcher. |
| Pages are statically generated per locale | `setRequestLocale` in every layout/page lets `/fa` and `/en` prerender (verified in the build output). |
| next-intl with `localePrefix: "always"`, `localeDetection: false` | Every URL carries its language (clean hreflang and caching). `/` always opens Persian, the store's default, regardless of browser language. |
| TypeScript 6.0 rather than 7.0 | TypeScript 7 (native compiler) is newer than the support range of typescript-eslint and Next.js tooling at the time of writing. |
| Prisma 7.10 (stable), not 8.0 RC | npm's `latest` tag currently points at a release candidate; we pin the last stable major. Prisma 7 needs a driver adapter (`@prisma/adapter-pg`) and `prisma.config.ts`. |
| Money as `bigint` Rial | No floats, no overflow at 2^53. Toman is display only. See [ADR 0001](adr/0001-money-representation.md). |
| Vazirmatn self-hosted via `@fontsource-variable/vazirmatn` | Fonts are bundled into the build with unicode-range subsets; no Google Fonts (unreliable from Iran). |
| Tailwind CSS 4 with CSS-variable tokens | Brand palette from the logo (orange `#DE803C`, charcoal `#272A2D`, cream `#F4F1D4`) in one place; shadcn/ui reads the same token names. Layout uses logical properties (`ms-`, `start-`) for RTL/LTR. |
| Security headers in `next.config.ts` | `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, HSTS. A nonce-based CSP comes with Phase 4. |
| `robots.txt` disallows everything | The store is not open; Phase 6b ships the real robots rules and sitemap. |

## Not implemented yet

Database schema, authentication, RBAC, admin panel, business services, search indexing, object storage, background jobs, page builder. See [ROADMAP.md](ROADMAP.md).
