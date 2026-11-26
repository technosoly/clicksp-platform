# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
