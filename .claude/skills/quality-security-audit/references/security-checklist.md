# Independent security review checklist

Reviewer works in a fresh context and reads the diff plus touched modules.

## Authentication and sessions
- [ ] Passwords Argon2id; no plaintext or reversible storage; reset tokens hashed, single-use, expiring.
- [ ] MFA enforced for levels 1–2 and privileged Staff; step-up on sensitive actions.
- [ ] Session cookies HttpOnly, Secure, SameSite; rotation on login/privilege change; revocation works.
- [ ] Rate limits on login, OTP, reset; generic error messages (no user enumeration).

## Authorization
- [ ] Every new service method calls `authorize()` before work; no role-name checks.
- [ ] Resource/scope checks present (IDOR); list endpoints filter by scope.
- [ ] Escalation guards untouched or strengthened; tests cover them.
- [ ] DTOs exclude fields the actor cannot see.

## Input and output
- [ ] Zod validation at every boundary; numeric inputs normalized; size limits.
- [ ] No raw SQL interpolation; `Prisma.sql` only.
- [ ] No `dangerouslySetInnerHTML` except the reviewed rich-text renderer and JSON-LD helper.
- [ ] CSP, HSTS and other headers unchanged or stricter.
- [ ] Uploads: MIME sniffing, size limits, re-encoding, separate origin.

## Money, stock, payments
- [ ] Amounts are bigint Rial through `src/lib/money`; no client-trusted totals.
- [ ] Stock changes only through `applyMovement`/reservation functions with row locks.
- [ ] Payment callback: lookup by our reference, server-side verify, amount match, idempotent, logged.
- [ ] Posted accounting records immutable; corrections by reversal.

## Secrets and infrastructure
- [ ] No secrets in client bundles, logs, error messages or repo; env validated.
- [ ] No endpoint executes code, shell, SQL or arbitrary HTML from requests or admin input.
- [ ] Deployment/rollback triggers require Super Admin + MFA and use least-privilege tokens.
- [ ] Audit log entries written for all sensitive operations.
