# Clicksp

Clicksp (CLICKSP Spare Parts, «کلیک لوازم یدکی») is an online store for motorcycle spare parts and accessories in Iran. Persian (`fa-IR`) is the default language, English is secondary, and all money is held internally in integer Iranian Rial.

> **Status: Phase 3 (database).** The app shell, design system, localization, money and Persian-text libraries, Docker and CI are in place, plus the full database schema with its integrity rules, the permission catalogue and the system seed. Authentication, the admin panel and business services come next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · Tailwind CSS 4 · shadcn/ui · next-intl 4 · Prisma 7 with PostgreSQL 17 · Redis 7 · Meilisearch 1.58 · Zod 4 · Vitest 5 · Playwright · Docker · GitHub Actions.

Why each piece was chosen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

Requirements: Node.js 22.18+, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env              # local placeholders; change the passwords
pnpm install                      # also generates the Prisma client
docker compose up -d postgres redis meilisearch
pnpm db:deploy                    # apply migrations
pnpm db:seed                      # system data: locales, IRR, roles, permissions, settings
pnpm dev                          # http://localhost:3000 → redirects to /fa
```

Run the whole stack in Docker instead: `docker compose --profile app up -d --build`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / run the standalone server |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Database integration tests (needs `TEST_DATABASE_URL`, a disposable database) |
| `pnpm test:e2e` | End-to-end tests (Playwright, needs `pnpm build` first) |
| `pnpm db:migrate` / `pnpm db:deploy` | Create a migration in development / apply migrations |
| `pnpm db:seed` | Idempotent system seed (no business data) |
| `pnpm db:drift` | Fail if the Prisma schema and the migrations differ |
| `pnpm skills:validate` | Check `.claude/` skills and agents |

## Repository layout

```
app/[locale]/(store)/   storefront pages (fa, en)
app/api/                health and readiness endpoints
src/lib/                money, persian-text, i18n, env, db, logger, utils
src/modules/            business modules (domain logic so far: sales totals, accounting journal, permission catalogue, default settings)
src/components/         UI components (shadcn/ui based) and layout
messages/               fa.json, en.json
prisma/                 schema (one file per area), migrations, system seed
e2e/                    Playwright tests
docs/                   architecture, roadmap, deployment, testing, ADRs
.claude/                project skills, agents and CLAUDE.md (engineering rules)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Deployment and network dependencies](docs/DEPLOYMENT.md)
- [Database](docs/DATABASE.md) and [ERD](docs/ERD.md)
- [Roles and permissions](docs/RBAC.md)
- [Accounting](docs/ACCOUNTING.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Changelog](CHANGELOG.md)
- Engineering rules for contributors and Claude Code: [.claude/CLAUDE.md](.claude/CLAUDE.md)

API.md is written with the first REST endpoints (Phase 4/6), so the docs never describe features that do not exist yet.
