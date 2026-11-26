# Clicksp

Clicksp (CLICKSP Spare Parts, «کلیک لوازم یدکی») is an online store for motorcycle spare parts and accessories in Iran. Persian (`fa-IR`) is the default language, English is secondary, and all money is held internally in integer Iranian Rial.

> **Status: Phase 4 (authentication).** The app shell, design system, localization, money and Persian-text libraries, Docker and CI, the full database schema with its integrity rules and the system seed are in place, plus admin sign-in with two-factor (TOTP), customer sign-in by SMS code (needs an SMS provider), sessions, the permission engine and a minimal admin panel. Admin management screens and business features come next. See [docs/ROADMAP.md](docs/ROADMAP.md).

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
pnpm admin:create-super           # your own admin account (once, see below)
pnpm dev                          # http://localhost:3000 → redirects to /fa
```

In `.env`, set `AUTH_SECRET` to a long random value (`openssl rand -base64 48`); sign-in does not work without it.

### Getting into the admin panel

1. Create the first Super Admin (only works while there is none; more admins are added from the panel in Phase 5):
   ```bash
   pnpm admin:create-super
   ```
   It asks for a username, display name, optional email and a password (at least 12 characters; nothing is shown while you type).
2. Open http://localhost:3000/fa/admin (or `/en/admin`) and sign in with that username and password.
3. On the first sign-in, scan the QR code with an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Aegis, …) and enter the 6-digit code.
4. Save the 10 backup codes somewhere private. Each one works once if you lose your phone.
5. From then on, every sign-in asks for the password and a current code from the app.

Lost both the phone and the backup codes? There is no reset from the web yet (Phase 5); ask a developer to clear `user_mfa` for your user on the server, after which the next sign-in asks to scan a new QR code.

### Customer sign-in

Customers sign in at `/fa/login` with their mobile number and an SMS code. Until an SMS provider is connected the page says phone sign-in is not available yet. For local development only, `SMS_PROVIDER=console` with `pnpm dev` prints the code in the terminal instead of sending it (refused in production builds).

Run the whole stack in Docker instead: `docker compose --profile app up -d --build`, then create the first Super Admin inside the migrate image:

```bash
docker compose --profile app run --rm migrate pnpm admin:create-super
```

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
| `pnpm admin:create-super` | Create the first Super Admin on the server (interactive) |
| `pnpm skills:validate` | Check `.claude/` skills and agents |

## Repository layout

```
app/[locale]/(store)/   storefront pages (fa, en), customer sign-in and account
app/[locale]/admin/     admin sign-in, two-factor steps and the admin panel
app/api/                health and readiness endpoints
src/lib/                money, persian-text, i18n, env, db, logger, http, security (tokens, Argon2id, TOTP, AES-GCM), utils
src/modules/            identity (sign-in, sessions, SMS adapter), rbac (authorize), audit, settings, and domain logic for sales and accounting
src/components/         UI components (shadcn/ui based) and layout
messages/               fa.json, en.json
prisma/                 schema (one file per area), migrations, system seed
scripts/                admin:create-super CLI and build helpers
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
