---
name: quality-security-audit
description: Quality gates and security audits for Clicksp — test strategy and coverage matrix, end-of-phase audit, independent security review, permission verification, database integrity checks, currency checks, and the phase report format. Use at the end of every phase, before merging security-critical changes, or when asked to verify, audit or report on quality.
---

# Quality and security audit

## Activation conditions
- End of any roadmap phase.
- PR touching auth, sessions, RBAC, payments, accounting, inventory concurrency, uploads, page-builder rendering, deployment, secrets.
- Request to "verify", "audit", "check", or "report".

## Purpose
Nothing is called done without evidence. Security-critical work is reviewed by someone (an agent in a fresh context) who did not write it.

## Workflow: end of phase
1. Run the full pipeline: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e`. Record counts and any failures verbatim.
2. Run migration check from empty DB: `pnpm prisma migrate reset --force --skip-seed && pnpm prisma migrate deploy && pnpm db:seed`, then the "no business data" assertion.
3. Run the permission matrix test suite (`rbac-security`).
4. Run the currency suite (`persian-localization` money tests + sales/accounting totals).
5. Run `/security-review` on the phase diff and delegate an independent review to the `security-auditor` agent using `references/security-checklist.md`.
6. Check docs against implementation (each doc section touched in this phase describes the real code; no future features documented as present).
7. Produce the phase report (format in `.claude/CLAUDE.md` §7). Unfixed findings are listed, never hidden.

## Test strategy
| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | domain functions, money, normalization, schemas |
| Integration | Vitest + real PostgreSQL (+ Redis, Meilisearch when needed) | services, constraints, triggers, transactions, concurrency |
| API | Vitest calling route handlers | authz, validation, status codes |
| E2E | Playwright | role journeys, storefront, RTL/LTR, responsive |
| Security | Vitest/Playwright | IDOR, escalation, CSRF, XSS payloads, rate limits |
| Recovery | script | backup → restore → smoke test |

Required suites (from the master requirements): authentication; all three admin levels allowed **and** denied; unauthorized access; product infrastructure; motorcycle compatibility; inventory movements; stock reservations; Rial/Toman conversions; accounting balance; order lifecycle; payment callbacks; RTL/LTR; language switching; responsive layouts; page builder validation; backup and recovery.

## Technical requirements
- Tests are deterministic: fixed clock, seeded randomness, isolated DB per worker.
- Test data is created inside tests with obviously synthetic values; never committed as seed data.
- CI uploads Playwright traces and coverage reports; coverage target ≥ 80% lines on `domain/` and `service/` layers (not a substitute for the required suites).

## Security requirements
- Findings classified Critical/High/Medium/Low; Critical/High block the phase.
- Secret scanning (gitleaks) and dependency audit (`pnpm audit --prod`) run in CI.

## Expected outputs
- Phase report; security review notes; updated `docs/TESTING.md` and `docs/SECURITY.md`; `CHANGELOG.md` entry.

## Documentation references
- Vitest: https://vitest.dev/guide/
- Playwright: https://playwright.dev/docs/intro
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- gitleaks: https://github.com/gitleaks/gitleaks

## Testing requirements
- This skill's own check: the phase report lists every required suite with run status; a suite marked "not run" means the phase is not complete.
