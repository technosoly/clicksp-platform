# Security

What is implemented so far. This file grows with each phase.

## Implemented

- **Authentication** (Phase 4, own code on `node:crypto`, [ADR 0002](adr/0002-own-authentication.md)):
  - Admins sign in with username or email + password at `/fa/admin/login`. Passwords are hashed with Argon2id (m=19 MiB, t=2, p=1); policy is 12–128 characters, not equal to the username; unknown users get the same answer and the same hashing time as a wrong password.
  - Two-factor sign-in (TOTP, RFC 6238) is mandatory for Super Admins, Business Admins and any Staff holding a pricing or money permission (which includes the default Store Staff bundle). Enrolment happens on first sign-in with a QR code; 10 single-use backup codes are shown once and stored as SHA-256 hashes. The TOTP secret is AES-256-GCM encrypted with a key derived (HKDF) from `AUTH_SECRET`, bound to the user id. A used code (time step) is never accepted again, also under concurrent requests. 5 wrong codes lock TOTP for 15 minutes.
  - Customers sign in with an Iranian mobile number and a 6-digit SMS code (3-minute lifetime, 5 tries, newest code only, single use). Codes are stored as HMAC-SHA-256 with a key derived from `AUTH_SECRET`. SMS goes through a pluggable adapter; with no provider configured, phone sign-in shows "not available yet". The development `console` provider is refused in production.
  - First Super Admin only from the server: `pnpm admin:create-super` (refuses if an active Super Admin exists). No web sign-up for admins.
- **Sessions** (Phase 4): 256-bit random tokens in HttpOnly cookies, Secure with the `__Host-` prefix on HTTPS and in every production build; only the SHA-256 is stored. Separate cookies and session kinds for admins (`__Host-clicksp_admin`, SameSite=Strict) and customers (`__Host-clicksp_session`, SameSite=Lax); a new sign-in revokes the browser's previous session; a token of one kind is never accepted as the other. Admin sessions: 10 minutes until TOTP is passed, then a new session id (rotation) with 30-minute idle and 12-hour absolute limits (from `system_settings`). Customer sessions: 14 days idle, 30 days absolute. Logout revokes the row; removing a user's admin role or disabling the user ends their sessions at the next request.
- **Authorization** (Phase 4): `authorize(actor, permission, resource)` in `src/modules/rbac/service/authorize.ts`. Deny by default, permission keys only (never role names), category/warehouse scopes for scoped grants (no scope or unknown resource = deny), expired role assignments and inactive roles/permissions ignored, step-up TOTP within 5 minutes for permissions marked MFA. Every denial writes a `security_events` row. The actor is built on the server from the session only.
- **Rate limits** (Phase 4, counted in PostgreSQL): admin login 5 failures per account from one IP, 20 per IP, and 50 per account from all addresses in 15 minutes (so a stranger can't cheaply lock the owner out); TOTP 5 wrong codes then a 15-minute lock, with each attempt reserved atomically before the check so parallel requests can't get more guesses; SMS codes 3 sends per number per 10 minutes and 10 per day, 10 per IP and 300 in total per 10 minutes, and 20 wrong codes per IP per 10 minutes across numbers. Requests without a valid client IP share one "unknown" bucket, so a missing or forged header never turns a limit off. Limits write `security_events`.
- **Audit** (Phase 4): admin sign-in, sign-out, TOTP enrolment and step-up, customer registration and first Super Admin creation write `audit_logs` (secret-looking fields redacted); every attempt writes `login_attempts`.
- **CSRF** (Phase 4): sign-in and sign-out are Server Actions, which Next.js only accepts from the same origin; the admin cookie is SameSite=Strict. There are no cookie-authenticated REST mutations yet.
- **Headers** (Phase 2): `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, HSTS (`next.config.ts`).
- **Secrets** (Phase 2): server-only, Zod-validated environment (`src/lib/env`); `.env*` files are git-ignored. Payment and shipping credentials are never stored in the database; provider rows only name the environment variable prefix.
- **Database integrity and anti-tampering** (Phase 3, see [DATABASE.md](DATABASE.md)):
  - Escalation guards in the database: permission level ceilings, protected system roles, last Super Admin guard ([RBAC.md](RBAC.md)).
  - Hash-chained, append-only `audit_logs`, verifiable with `SELECT audit_logs_verify()`; append-only login attempts, security events, inventory movements, order status history, price history, payment callbacks, tracking events.
  - Only hashes of session tokens, verification codes, guest cart tokens and MFA backup codes are stored (CHECK on SHA-256 hex format where the hash is fixed-length). The TOTP secret is stored encrypted by the app.
  - Immutable financial records: posted journal entries, final payments, issued invoices, order lines and frozen order amounts.
  - No permanent deletes of users, orders, accounts, payments, refunds or invoices, and no `TRUNCATE` of ledgers and logs.
  - Permission keys are immutable; approval requests and decisions are final; an order is paid only with a matching succeeded payment.
  - Independent security review done on Phase 3; its findings were fixed in `20261126100300_security_hardening` or are listed as known gaps in [DATABASE.md](DATABASE.md#known-gaps-until-the-phase-10-database-roles).
  - Media types are allow-listed (no SVG, HTML or scripts); banner links must be relative or `https://`.
  - No business data is seeded.

## Personal data (PII) stored

Retention rules are set with the owner before launch (Phase 10).

| Table | Columns | Notes |
|---|---|---|
| `users` | email, phone_number, name | Users are disabled, never deleted; anonymization procedure to be defined. |
| `user_profiles` | first_name, last_name | |
| `delivery_addresses` | recipient_name, phone, province, city, address_line, plaque, unit, postal_code | Soft delete. |
| `orders`, `order_addresses` | customer name, phone, email, note; address snapshot | Kept for accounting and legal records. |
| `invoices` | buyer_snapshot | Immutable after issue. |
| `sessions`, `login_attempts`, `security_events`, `audit_logs`, `payment_callback_logs` | ip_address, user_agent | Security logs. |
| `notifications` | recipient (phone or email) | OTP codes are never stored in params. |
| `payment_transactions` | masked_card | Masked by the gateway; full card numbers are never stored. |

No national ID numbers are stored.

## Planned (not implemented)

- **Content-Security-Policy with nonces**: not added yet. A nonce CSP makes every page render per request, which would turn the static storefront pages dynamic. Planned for Phase 5 on the admin and account routes only (already dynamic), with a static policy for the storefront.
- Password reset and password change: Phase 5, with admin user management (a Super Admin resets other admins; the CLI can only create the first one).
- The client IP comes from one header, `TRUSTED_IP_HEADER` (`x-real-ip` by default, or the last `x-forwarded-for` entry), which the reverse proxy must overwrite (Phase 10 deployment config). Without a proxy every request is in the shared "unknown" bucket.
- Removing an admin role or disabling a user makes their sessions unusable at the next request, but the session rows are only revoked when the user-management services exist (Phase 5, which also revokes them on role change and password reset).
- An admin whose account has a phone number could also get a *customer* session with an SMS code. Customer sessions never carry admin permissions (separate cookie, session kind and actor); Phase 5 user management will keep admin phone numbers off customer sign-in.
- Phase 4 independent security review: no critical findings; the high and medium findings (spoofable IP limits, two-factor lockout race, SMS-code guessing limits, admin lockout abuse) and the low ones on cookies, enrolment races, AES-GCM tag length, session replacement and the CLI check were fixed in the same pull request; the two items above are deferred to Phase 5.
- Phase 10: separate least-privilege database roles for the app and for migrations, encrypted off-site backups.
