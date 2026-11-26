# Clicksp

Clicksp (CLICKSP Spare Parts, «کلیک لوازم یدکی») is an online store for motorcycle spare parts and accessories in Iran. Persian (`fa-IR`) is the default language, English is secondary, and all money is held internally in integer Iranian Rial.

> **Status: Phase 2 (project foundation).** The app shell, design system, localization, core money and Persian-text libraries, database tooling, Docker and CI are in place. The database schema, authentication, admin panel and business modules come in later phases. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · Tailwind CSS 4 · shadcn/ui · next-intl 4 · Prisma 7 with PostgreSQL 17 · Redis 7 · Meilisearch 1.58 · Zod 4 · Vitest 5 · Playwright · Docker · GitHub Actions.

Why each piece was chosen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

Requirements: Node.js 22.12+, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env              # local placeholders; change the passwords
pnpm install                      # also generates the Prisma client
docker compose up -d postgres redis meilisearch
pnpm db:deploy                    # apply migrations
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
| `pnpm test:e2e` | End-to-end tests (Playwright, needs `pnpm build` first) |
| `pnpm db:migrate` / `pnpm db:deploy` | Create a migration in development / apply migrations |
| `pnpm skills:validate` | Check `.claude/` skills and agents |

## Repository layout

```
app/[locale]/(store)/   storefront pages (fa, en)
app/api/                health and readiness endpoints
src/lib/                money, persian-text, i18n, env, db, logger, utils
src/modules/            business modules (domain logic so far: sales totals, accounting journal)
src/components/         UI components (shadcn/ui based) and layout
messages/               fa.json, en.json
prisma/                 schema and migrations
e2e/                    Playwright tests
docs/                   architecture, roadmap, deployment, testing, ADRs
.claude/                project skills, agents and CLAUDE.md (engineering rules)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Deployment and network dependencies](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Changelog](CHANGELOG.md)
- Engineering rules for contributors and Claude Code: [.claude/CLAUDE.md](.claude/CLAUDE.md)

The remaining documents named in the project brief (DATABASE.md, ERD.md, RBAC.md, SECURITY.md, ACCOUNTING.md, API.md) are written in the phase that implements what they describe, so they never document features that do not exist yet.
