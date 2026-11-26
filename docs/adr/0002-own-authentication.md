# ADR 0002: Own authentication on node:crypto instead of Better Auth

- Status: accepted (Phase 4), pending the owner's review in the Phase 4 pull request
- Date: 2026-11-26

## Context
CLAUDE.md listed Better Auth for authentication. The Phase 3 schema was shaped so Better Auth could map onto it, but Phase 4 showed the fit is poor for what this project requires:

- Session tokens and verification codes must be stored **hashed** (`sessions.token_hash`, `verification_tokens.value_hash`, with `CHECK` constraints on the 64-hex format). Better Auth's tables keep the token value it generates; fitting it into these columns means patching its storage, not configuring it.
- Admin and customer sessions are separate realms with different cookies, lifetimes (30 min idle / 12 h absolute vs 30 days) and rules (mandatory TOTP for levels 1–2 and for Staff with money permissions, step-up MFA per permission). That needs three plugins (username, phone number, two-factor) plus custom hooks around each.
- OTP codes are keyed with a server secret (HMAC) so a leaked database row cannot be brute-forced over the 10^6 possible codes, and TOTP secrets are encrypted with an app key with the user id bound as associated data.
- Every login writes `login_attempts`, `security_events` and the hash-chained `audit_logs` inside the same transaction as the session change.

The surface needed is small: password hashing, random tokens, TOTP (RFC 6238), AES-GCM, and session rows.

## Decision
- Implement authentication in `src/modules/identity` on `node:crypto`, with **Argon2id** from `@node-rs/argon2` (prebuilt binaries, no build step; Node 22 has no built-in Argon2) and `qrcode` (pure JS) for the enrolment QR code. TOTP is implemented in ~60 lines and tested against the RFC 4226/6238 vectors.
- Rate limits for login and OTP are counted from the append-only `login_attempts`, `verification_tokens` and `security_events` tables in PostgreSQL instead of Redis. They are durable, need no extra service to run locally, and the volume (a single shop's admins and OTP requests) is tiny. Redis stays available for caching; a Redis limiter can replace the counters behind the same functions if traffic requires it.
- CLAUDE.md's stack table is updated to match.

## Consequences
- We own security-sensitive code, so it is covered by unit tests (RFC vectors, tampering, replay), integration tests on PostgreSQL (every flow, lockouts, rate limits, the permission matrix) and an independent security review before merge.
- No OAuth/social login. If ever needed, it is added as another `auth_accounts.provider_id`.
- Password reset is not built yet: admins are created and reset by a Super Admin (Phase 5); the first Super Admin is created on the server with `pnpm admin:create-super`.
