# Security

What is implemented so far. Authentication, sessions, MFA, the authorization engine, rate limiting and CSP arrive in Phase 4; this file grows with them.

## Implemented

- **Headers** (Phase 2): `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, HSTS (`next.config.ts`).
- **Secrets** (Phase 2): server-only, Zod-validated environment (`src/lib/env`); `.env*` files are git-ignored. Payment and shipping credentials are never stored in the database; provider rows only name the environment variable prefix.
- **Database integrity and anti-tampering** (Phase 3, see [DATABASE.md](DATABASE.md)):
  - Escalation guards in the database: permission level ceilings, protected system roles, last Super Admin guard ([RBAC.md](RBAC.md)).
  - Hash-chained, append-only `audit_logs`, verifiable with `SELECT audit_logs_verify()`; append-only login attempts, security events, inventory movements, order status history, price history, payment callbacks, tracking events.
  - Only hashes of session tokens, verification codes, guest cart tokens and MFA backup codes are stored (CHECK on SHA-256 hex format where the hash is fixed-length). The TOTP secret is stored encrypted by the app.
  - Immutable financial records: posted journal entries, final payments, issued invoices, order lines and frozen order amounts.
  - No permanent deletes of users, orders, accounts, payments, refunds or invoices.
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

Phase 4: Better Auth login, Argon2id passwords, TOTP for levels 1–2, session rotation and revocation, rate limits in Redis, CSRF checks, nonce-based CSP, `authorize()` with security events on denial. Phase 10: separate least-privilege database roles for the app and for migrations, encrypted off-site backups.
