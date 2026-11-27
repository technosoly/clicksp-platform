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
- **Admin account management** (Phase 5, [RBAC.md](RBAC.md#screens-per-level-phase-5)): escalation guards in the services (Business Admins manage Store Staff accounts only; only level 1 manages levels 1-2; nobody manages their own account or edits a role they hold; permissions are granted, removed or re-scoped only by an actor who holds them; the Super Admin bundle is fixed). Every change writes an audit row in the same transaction (`staff.*` / `admin.*` / `role.*`); changes need a TOTP check within 5 minutes; denials write security events. Role changes, disabling, two-factor removal and password resets revoke the account's sessions.
- **Password links** (Phase 5): new admins get a one-time "set your password" link (72 h), resets a 30-minute link, issued by a manager in the panel or by `pnpm admin:reset-link` on the server. 256-bit tokens, only the SHA-256 is stored, single use (conditional update), a new link retires earlier ones, the token travels in the URL fragment and is removed from the address bar once read. Wrong links: same answer for unknown, used, expired or disabled; 20 per IP per 15 minutes. A weak password is refused before the link is used. Using a link revokes every session of the account.
- **Own password change** (Phase 5): needs the current password (5 wrong tries per 15 minutes, then locked for the window), keeps the current session and signs out the others.
- **Admin phone numbers** (Phase 5): an account with an admin role never gets a customer session, even with a verified phone number (refused at SMS-code verification, and `getCustomer` ignores such sessions).
- **Content-Security-Policy** (Phase 5, `src/lib/security/csp.ts`, set in `proxy.ts`): admin, customer sign-in, account, cart and checkout pages (rendered per request) get a fresh 128-bit nonce with `script-src 'self' 'nonce-…' 'strict-dynamic'`; Next.js adds the nonce to its own scripts. Other storefront pages get a static policy that still allows only this origin but permits inline scripts (they now render per request too, so moving them to the nonce policy is a planned hardening). Both: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`. Inline style attributes are allowed (`style-src-attr`). E2E checks the nonce on every script and no CSP violations.
- **Carts** (Phase 6b): a cart is found only from the customer session or the guest cart cookie (256-bit random token, HttpOnly, SameSite=Lax, `__Host-` on HTTPS, 30 days; only its SHA-256 is stored), never from ids in the request. Only tokens the server issued are used: a cookie with no active cart behind it gets a fresh token, so a planted cookie can't seed a cart. A guest cart is merged into the customer's cart once (claimed by a conditional update, claim and copy in one transaction), and a change never lands in a cart retired meanwhile (status re-checked under the row lock). Each new guest cart deletes up to 20 guest carts more than 30 days past expiry. Cart writes are Server Actions. Prices, limits and stock are always read on the server. Known gap: no per-IP limit on starting guest carts yet (planned with the background jobs).
- **Checkout and orders** (Phase 6b): only a signed-in customer can order; the order uses the account's verified mobile number. Prices, shipping and totals are computed on the server; the browser sends only the address, the chosen method and a note (Zod-validated). Order pages and the order list look orders up by the signed-in customer's id together with the order number, so another customer's number is a 404. After sign-in a customer is returned only to `/account`, `/cart` or `/checkout` (allow-list, no open redirect).
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

- The client IP comes from one header, `TRUSTED_IP_HEADER` (`x-real-ip` by default, or the last `x-forwarded-for` entry), which the reverse proxy must overwrite (Phase 10 deployment config). Without a proxy every request is in the shared "unknown" bucket.
- The storefront's static CSP allows inline scripts (Next.js inlines hydration data into pre-rendered pages, and a nonce needs per-request rendering). Hashes of the inline scripts could replace `'unsafe-inline'` later (Phase 9).
- Resource scopes (categories, warehouses per Store Staff member) have no editing screen until those entities exist (Phase 6).
- Phase 4 independent security review: no critical findings; the high and medium findings (spoofable IP limits, two-factor lockout race, SMS-code guessing limits, admin lockout abuse) and the low ones on cookies, enrolment races, AES-GCM tag length, session replacement and the CLI check were fixed in the same pull request; the two deferred items (session rows on role change, admin phone numbers) were done in Phase 5.
- Phase 10: separate least-privilege database roles for the app and for migrations, encrypted off-site backups.
