---
name: rbac-security
description: Authentication, sessions, MFA and permission-based authorization for Clicksp's three admin levels (Super Admin, Business Admin, Store Staff) and customers. Use for any change touching login, logout, password reset, OTP, sessions, roles, permissions, resource scopes, approval workflows, audit logs or rate limiting.
---

# RBAC and security

## Activation conditions
- Code in `src/modules/identity`, `rbac`, `audit`, or any `authorize()` call.
- New service method, route handler, Server Action or admin page.
- Adding a permission key or changing default role bundles.
- Anything with "login", "session", "MFA", "OTP", "reset", "role", "permission", "approval", "audit".

## Purpose
Deny-by-default, server-enforced, permission-based authorization with resource scopes, plus secure authentication, so that no user can act beyond their granted permissions or escalate privileges.

## Model
- `roles.level`: 1 Super Admin, 2 Business Admin, 3 Store Staff, 0 Customer. `is_system` roles cannot be deleted.
- `permissions.key`: `<resource>.<action>` e.g. `product.create`, `price.update`, `accounting.view`, `role.manage`. Full catalogue: `references/permission-catalogue.md`.
- `permissions.scope_type` says a permission *can* be limited by category or warehouse; `role_permissions.is_scoped` says this role holds it scoped. `user_role_scopes` rows (category IDs, warehouse IDs) limit a user-role's scoped grants; a scoped grant with no matching scope rows denies. Unscoped grants ignore scope rows.
- `permissions.max_level` is a hard ceiling enforced by a database trigger: a role can hold a permission only if `1 <= role.level <= max_level`.
- `admin_approvals`: pending actions (e.g. Staff price change) executed only when an approver with the permission approves.

## Workflow
1. **Every service method** begins with:
   ```ts
   await authorize(actor, 'product.update', { type: 'product', id, categoryIds })
   ```
   `authorize` (`src/modules/rbac/service/authorize.ts`) checks the actor's effective permissions (loaded once per request from the session), checks scope against the resource, writes a `security_events` row on denial and throws `AuthzError`; for permissions marked `requiresMfa` it throws `MfaRequiredError` unless the session passed TOTP within `security.step_up_mfa_seconds`.
2. **Never check role names** (`if (role === 'admin')` is forbidden). Hard-coded checks allowed only for the escalation guards below.
3. **Escalation guards** (in `rbac/service`, independent of permission data):
   - Only level 1 actors can assign level 1 roles or edit level 1 users.
   - An actor can grant only permissions they currently hold, and only to roles of a strictly lower level.
   - An actor cannot change their own roles, permissions or scopes.
   - The last active Super Admin cannot be disabled, demoted or deleted.
4. **Sensitive actions** call `requireRecentMfa(actor, 5 * 60)`: permission/role changes, permanent deletes, payment provider config, refunds above threshold, deploy/rollback requests, backup actions.
5. **Approval workflow**: when the actor has `<perm>.propose` but not `<perm>`, the service creates `admin_approvals(action, payload, requested_by)` and returns `202`. Approval re-validates the payload and runs the action as the approver, recording both users.
6. **Audit**: every create/update/delete in admin services writes `audit_logs` (actor, action, entity, before/after diff with secrets redacted, IP, user agent, request id, prev_hash, hash).
7. Update `docs/RBAC.md` matrix whenever defaults change.

## Technical requirements: authentication
- Admins: email/username + password (Argon2id) + **mandatory TOTP** for levels 1 and 2 and any Staff with financial/pricing permissions (`FINANCIAL_PERMISSIONS` in `identity/domain/policy.ts`; the default Store Staff bundle includes `price.update.propose`, so default Staff use TOTP too). Recovery codes stored hashed.
- Customers: mobile number + SMS OTP through the SMS adapter (`src/modules/identity/sms`; provider pluggable; the `console` provider is for development only and is refused when `NODE_ENV` or `APP_ENV` is production).
- Sessions: opaque random token in `HttpOnly; Secure; SameSite=Lax; Path=/` cookie; stored hashed in `sessions`; admin cookie name differs from customer cookie. Idle timeout 30 min / absolute 12 h for admins; rotate on login and privilege change; revoke on password reset and on role change.
- Password reset: single-use token, stored hashed, 30-minute expiry, same response whether the account exists or not.
- Rate limits (counted in PostgreSQL from `login_attempts`, `verification_tokens` and `security_events`, ADR 0002): login 5 failures/15 min per account and 20/15 min per IP; OTP send 3/10 min per phone and 10/10 min per IP; 5 tries per OTP code; TOTP locks for 15 min after 5 wrong codes. Exceeding writes `security_events`.
- Implementation (ADR 0002): own code in `src/modules/identity` on `node:crypto` + Argon2id; no Better Auth.
- First Super Admin is created by a server CLI command (`pnpm admin:create-super`), never by a web form.

## Security requirements
- Resource checks prevent IDOR: customers access only their own orders/addresses/carts; Staff only scoped categories/warehouses/orders.
- No permission data is sent to the client beyond the actor's own effective permission keys (used only to hide UI).
- CSRF: Server Actions rely on Next.js origin checks; cookie-authenticated REST mutations require `Origin` match and a CSRF token header.
- Audit log rows are append-only (trigger) and hash-chained.

## Expected outputs
- Service code with `authorize()` + tests.
- Updated `references/permission-catalogue.md` and `docs/RBAC.md`.
- `security-auditor` review note on the PR.

## Documentation references
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- RFC 6238 (TOTP): https://www.rfc-editor.org/rfc/rfc6238

## Testing requirements
- Table-driven test generated from the permission matrix: for **each** permission × each of the three admin levels, assert allowed **and** denied outcomes (403 + `security_events` row).
- Escalation tests: Business Admin cannot grant Super Admin, cannot grant permissions it lacks, cannot edit own roles; last Super Admin cannot be removed.
- Session tests: revocation, rotation, expiry, reset revokes all sessions.
- Rate-limit tests for login, OTP and reset.
- IDOR tests: customer A cannot read customer B's order by ID; Staff cannot read out-of-scope order.
- Playwright: each admin level sees only its navigation and gets 403 on direct URL access to others.
