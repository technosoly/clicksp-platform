# Clicksp — Project Engineering Standards

Clicksp (CLICKSP Spare Parts, "Click Lavazem Yadaki") is a single-owner B2C e-commerce platform for motorcycle spare parts and accessories in Iran. Persian (`fa-IR`) is the default language, English (`en`) is secondary, and the internal currency is the Iranian Rial (IRR).

This file holds the rules that apply to **every** change. Domain-specific rules live in `.claude/skills/*`. Skills link back here instead of repeating these rules. If a skill and this file conflict, this file wins and the skill must be fixed.

## 1. Priorities (in order)

1. Data integrity: money, stock, compatibility (fitment), orders.
2. Security: authentication, authorization, payments, uploads, secrets.
3. Performance on slow mobile networks and low-end Android devices.
4. Maintainability: clear module boundaries, typed code, tests.
5. Feature breadth.

Never trade a higher priority for a lower one without an Architecture Decision Record (ADR) in `docs/adr/`.

## 2. Stack (pinned, verify before upgrading)

| Concern | Choice |
|---|---|
| App | Next.js App Router, React, TypeScript `strict` |
| UI | Tailwind CSS, shadcn/ui, Motion (sparingly) |
| i18n | next-intl, routes `/fa` (default) and `/en` |
| DB | PostgreSQL (self-hosted), Prisma ORM + raw SQL migrations for triggers/constraints |
| Auth | Own implementation on `node:crypto` + Argon2id (`@node-rs/argon2`): DB sessions, TOTP, SMS OTP, plus the project's own RBAC engine (ADR 0002) |
| Jobs | pg-boss (queue in PostgreSQL) |
| Cache / rate limit | Redis for caches; login/OTP rate limits counted in PostgreSQL (ADR 0002) |
| Search | Meilisearch + PostgreSQL `pg_trgm` / full-text fallback |
| Storage | S3-compatible API (MinIO or an Iranian S3 provider) |
| Validation | Zod at every boundary |
| Tests | Vitest (unit + integration on real PostgreSQL), Playwright (E2E) |
| Deploy | Docker, Docker Compose, GitHub Actions, Linux VPS |

Before implementing or upgrading an important integration (Next.js caching, Prisma, Meilisearch, payment or shipping providers), read the **current official documentation** (Context7 if installed, otherwise the vendor's docs site). Record the version and doc URL in the PR description.

Do not add a dependency without stating why an existing one or a few lines of code are not enough. Prefer packages with active maintenance and no native build step.

## 3. Repository layout

```
app/[locale]/(store)/...       storefront (Server Components first)
app/[locale]/admin/...         admin panel (permission-gated layouts)
app/api/v1/...                 REST handlers (OpenAPI documented)
app/api/webhooks/...           payment / shipping callbacks
src/modules/<module>/
    domain/    pure logic, no I/O
    service/   use cases, transactions, authorization
    repo/      the only place that touches Prisma
    api/       Zod schemas, route handler glue
    tests/
src/lib/       money, i18n, persian-text, http, security, logger, env
prisma/        schema + migrations (SQL for triggers/constraints)
worker/        background job runner
docs/          ARCHITECTURE.md, DATABASE.md, RBAC.md, ... and adr/
```

Modules: `identity`, `rbac`, `audit`, `catalog`, `vehicles`, `compatibility`, `search`, `inventory`, `sales`, `payments`, `shipping`, `accounting`, `content`, `pagebuilder`, `settings`, `media`, `jobs`.

## 4. Non-negotiable rules

### Architecture
- Only `repo/` imports Prisma. Pages, components and route handlers call **services**.
- A module calls another module only through that module's `service/` public API.
- Cross-module side effects (search reindex, SMS, accounting posting after payment) go through the **transactional outbox** (`outbox_events`) written in the same DB transaction as the business change.

### Authorization
- Every service method receives an `actor` and calls `authorize(actor, '<permission.key>', resource?)` before doing anything. **Deny by default.**
- Code checks **permission keys**, never role names.
- Never trust the client for identity, role, price, stock, totals or payment status.

### Money
- All amounts are **integer Rial** stored as `BIGINT`, handled as `bigint` through `src/lib/money`. No floats, no `Number` arithmetic on money.
- Toman is **display only**. Only `src/lib/money` converts or formats. Components never divide or multiply by 10.

### Data
- No fictional business data: never seed products, categories, brands, manufacturers, motorcycle models, compatibility, inventory, customers or orders. Seeds may contain only system roles, permissions, locales, currencies and required settings.
- Financial and stock ledgers are append-only; corrections are reversals.
- Critical writes (stock, orders, payments, accounting) run in a single DB transaction.

### Text and locale
- All user-facing text comes from translation messages or `*_translations` tables. No hardcoded Persian or English strings in components.
- Persian text used for search, identifiers and imports passes through `src/lib/persian-text` normalization.
- Use CSS logical properties (`ms-`, `pe-`, `start-`, `end-`), never `left`/`right` for layout.

### Security
- Never expose secrets to the browser. Server-only env goes through `src/lib/env` (Zod-validated); `NEXT_PUBLIC_` only for non-secret values.
- Never commit credentials or `.env*` files (only `.env.example`).
- Never execute code, SQL, HTML or JavaScript supplied through the admin panel or page builder.
- Log every sensitive operation to `audit_logs`.

### Integrations
- Do not invent API endpoints, credentials, rates or prices for payment, SMS or shipping providers. Build an adapter interface plus tests; implement a real adapter only from official documentation with real sandbox credentials supplied by the owner.
- Hosting, SMS provider and payment providers are **pluggable configuration**. The site must build and run locally without any of them.
- Do not depend at runtime on services that may be unreachable from Iranian hosting (Google Fonts, foreign SaaS, CDNs). Bundle fonts; document every external network dependency in `docs/DEPLOYMENT.md`.

## 5. Workflow

1. Work phase by phase (see `docs/ROADMAP.md`). Do not build several phases in one uncontrolled operation.
2. Pick the matching skill(s) before starting a task. Use agents only when the task is large, parallelizable, or needs independent review.
3. Small, reviewable commits. Conventional commit messages (`feat(inventory): ...`).
4. **Security-critical changes** (auth, sessions, RBAC, payments, accounting, uploads, page builder rendering, deployment) must be reviewed by the `security-auditor` agent in a fresh context, plus `/security-review`, before merge.
5. Documentation describes what **is** implemented. Update the relevant doc in the same change. Never document a future feature as present.

## 6. Definition of done

A change is done only when:
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; E2E passes for touched flows.
- New behaviour has tests, including **denied** access for each admin level where permissions apply.
- Migrations apply cleanly from an empty database.
- Docs and `CHANGELOG.md` are updated.
- No feature is reported as complete without a passing test that exercises it.

## 7. Phase report format

At the end of every phase, report:
- What was implemented.
- Files created or changed.
- Tests executed, with pass/fail counts and any failures quoted.
- Remaining issues and known gaps.
- Next recommended phase.

## 8. Skills index

| Skill | Use for |
|---|---|
| project-architecture | module boundaries, new modules/dependencies, ADRs, outbox |
| database-architect | Prisma schema, migrations, indexes, SQL constraints/triggers |
| rbac-security | auth, sessions, MFA, roles, permissions, audit, approvals |
| motorcycle-domain | motorcycle catalog, fitment, part numbers, imports |
| inventory-engine | warehouses, stock movements, reservations, counts |
| iranian-ecommerce | payment gateways, shipping carriers, SMS, invoices, tax |
| accounting-engine | double-entry ledger, periods, refunds, reports |
| persian-localization | fa/en, RTL/LTR, Jalali, digits, money display, normalization |
| bilingual-content | translatable entities, translation tables, fallbacks |
| ecommerce-frontend | storefront UI, design tokens, components |
| admin-dashboard | admin UI, per-role navigation, forms, tables |
| page-builder | visual page builder, component registry, revisions |
| ecommerce-seo | metadata, sitemaps, hreflang, structured data |
| performance-engineering | bundle size, caching, queries, Core Web Vitals |
| quality-security-audit | test matrix, phase audits, security review |
