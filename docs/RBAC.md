# Roles and permissions

What is implemented: the data model, the permission catalogue, the default bundles of the three admin levels and the database-level escalation guards (Phase 3); the `authorize()` engine, admin and customer sign-in, sessions and TOTP (Phase 4); the screens and services to manage admin accounts, roles and permissions, the per-level admin navigation and the audit log viewer (Phase 5).

## Checking a permission (Phase 4)

```ts
await authorize(actor, "product.update", { type: "product", id, categoryIds })
```

- `actor` comes from the session (`requireAdmin()` in pages/actions); never from request data.
- Deny by default: a key the actor's active, unexpired roles don't grant is refused with `AuthzError` (403) and a `security_events` row (`authz.denied`).
- Scoped grants (Store Staff) need the resource's categories or warehouses, and every one of them must be in the user's scope. Missing resource information denies.
- Permissions marked MFA also need a TOTP check in the last `security.step_up_mfa_seconds` (300 s), otherwise `MfaRequiredError`; the admin re-enters a code at `/admin/mfa?next=<page>` and returns to the page (only `/admin/...` paths are accepted as `next`). Read-only screens of such a permission (the admin list behind `user.manage_staff`, the role list behind `role.manage`) call `authorize(..., { stepUp: false })`: the grant is still checked, the code is asked for only when something changes.
- The admin navigation hides links the user does not hold, but only `authorize()` grants access.
- Tested for **every permission × each of the three admin levels** (allowed and denied, in and out of scope) on PostgreSQL in `tests/integration/auth.test.ts`, and on the pure engine in `src/modules/rbac/tests/authorize.test.ts`.

## Who must use two-factor sign-in

Super Admin and Business Admin always (`security.mfa_required_levels`, levels 1 and 2 can't be removed from it), plus any user holding a permission in `FINANCIAL_PERMISSIONS` (`src/modules/identity/domain/policy.ts`: prices, discounts, coupons, refunds, payment data, costs, accounting, financial reports, payment providers). The default Store Staff bundle includes `price.update.propose`, so default Staff use TOTP too.

## Model

- **Permissions** are keys `<resource>.<action>` (65 today), defined in `src/modules/rbac/domain/permission-catalogue.ts` and synced into `permissions` by the seed. Code checks permission keys, never role names.
- **Roles** have a level: 1 Super Admin, 2 Business Admin, 3 Store Staff, 0 Customer. The four system roles (`super_admin`, `business_admin`, `store_staff`, `customer`) cannot be deleted or re-levelled. Super Admin can create more roles and change any role's permissions within the guards below.
- **Scopes:** a permission can have a scope type (category or warehouse). When a role holds it *scoped* (`role_permissions.is_scoped`), the user's `user_role_scopes` rows decide which categories or warehouses it covers, and **no scope rows means deny**. Unscoped grants (Super Admin, Business Admin) cover everything.
- **Approvals:** `.propose` permissions (`price.update.propose`, `inventory.adjust.propose`) let Staff request a change that runs only after someone holding the real permission approves it in `admin_approvals`. The requester can never approve their own request (database CHECK).
- **MFA:** permissions marked `requiresMfa` need a recent MFA check when used (enforced by the Phase 4 engine).

## Guards that no permission edit can bypass

Enforced by database triggers (tested in `tests/integration/rbac-audit.test.ts`):

1. **Level ceiling.** Every permission has `max_level`. A role can hold it only when `1 <= role level <= max_level`. Super Admin-only permissions have `max_level = 1`, so a Business Admin or Staff role, system or custom, can never hold them, even if role data is edited directly. Customers (level 0) hold no permissions.
2. System roles keep their key and level and cannot be deleted.
3. The last active Super Admin cannot be disabled, lose the role or have the role deactivated. Only grants without an expiry date count.
4. Permission keys can't be renamed, and a scope type can't change while the permission is granted scoped.
5. Approval requests can't be edited, decisions are final, and the requester can't decide.

Service rules on top (Phase 5, `src/modules/rbac/domain/escalation.ts`, used by `identity/service/admin-users.ts` and `rbac/service/roles.ts`; tested in `src/modules/rbac/tests/escalation.test.ts` and `tests/integration/admin-management.test.ts`):

6. **Who manages which accounts.** Store Staff accounts (level 3) need `user.manage_staff` (or `user.manage_admins`) and an actor of level 1 or 2. Business Admin and Super Admin accounts (levels 1-2) need `user.manage_admins` **and** a level 1 actor, whatever permissions a role has been given. An account's level is the strongest admin role it has ever been assigned (expired or not). Both the account's current level and the new role's level must be manageable when changing a role.
7. **Nobody manages their own account** through these screens (role, status, password link, two-factor reset, sign-out); their own password and devices are on My account.
8. **Role editing:** only roles of a strictly lower rank than the actor (levels 2-3 for a Super Admin); the Super Admin bundle is fixed; nobody edits a role they hold; system roles can't be switched off.
9. **Grant only what you hold:** a permission can be added, removed or re-scoped only by an actor holding it (`x.propose` counts as held through `x`). Cells the actor may not change keep their current state whatever the form sends. Above-ceiling permissions are never granted (and the database refuses them anyway). The same rule applies to **assigning a role**: an account can be given a role only when the actor holds every permission it grants (unscoped grants need the actor's own grant to be unscoped). Likewise every change to an account (password link, two-factor reset, role, status, sign-out) needs the actor to hold every permission the account's admin roles grant, so nobody takes over an account that can do more than they can.
10. Changing an account's role, disabling it, removing its two-factor enrolment and using a password link **revoke all its sessions**. Changing the role or disabling the account also retires its unused password links, so a link issued for a Store Staff account can't be used after a promotion. Role permission edits apply at the members' next request (effective permissions are loaded per request), so sessions are kept.

## Screens per level (Phases 5-6)

| Screen | Super Admin | Business Admin | Store Staff |
|---|---|---|---|
| Dashboard, My account (password change, signed-in devices) | ✓ | ✓ | ✓ |
| People › Admins and staff (`/admin/people/users`) | all levels | Store Staff accounts only | 403 |
| People › Roles and permissions (`/admin/people/roles`) | ✓ (edits levels 2-3) | 403 | 403 |
| Audit log (`/admin/audit`) | everything + security events | business and staff actions only (`staff.*`, catalog, inventory, sales, finance, content) | 403 |
| Products, categories (`/admin/products`, `/admin/categories`) | ✓ | ✓ | only inside their categories; prices by request |
| Brands (`/admin/brands`) | ✓ | ✓ | ✓ |
| Approvals (`/admin/approvals`) | review price requests | review price requests | their own requests |
| Inventory, orders, content areas (coming in later parts of Phase 6) | ✓ | ✓ | ✓ (scoped) |
| Customers, accounting, reports, shipping, payment gateways, settings | ✓ | ✓ | 403 |
| Page builder, technical (integrations, backups, deployments, monitoring) | ✓ | 403 | 403 |

The navigation (`src/components/admin/admin-nav.ts`) shows an area when the admin holds any one of its permissions; typed URLs of hidden areas answer **403** with a localized page (Next.js `forbidden()`). Areas marked "Coming soon" (inventory, orders, finance, content, settings, technical) are only reachable by the admins who will use them, and say that the screens arrive in Phase 6 or later.

Account lifecycle: a manager creates an account without a password and hands over a **one-time link** (72 hours) to set it; resets use a 30-minute link. Links are 256-bit random tokens, stored as SHA-256, single use, carried in the URL fragment (never sent to the server in a request line or Referer), and a new link retires older ones. Two-factor enrolment follows at the first sign-in. Lost phone and backup codes: a manager removes the enrolment. Owner locked out of the only Super Admin account: `pnpm admin:reset-link --username <name> [--reset-mfa]` on the server.

Scopes (which categories or warehouses a Store Staff member covers) are stored per user-role. **Category scopes** are set on the account screen (People › the staff member › "Categories this person works on", Phase 6) by an admin who can manage the account; the admin can only hand out categories they cover themselves for every scoped permission of the role (`x.propose` counts as covered through `x`). A category scope covers the category **and everything below it** (expanded when permissions are loaded, per request). A product is in scope only when **all** its categories (primary and extra) are. No scope rows still means deny. Because a scope follows the tree, **moving a category** (changing its parent) changes what other staff can see, so it needs unscoped `category.manage` (Business or Super Admin); scoped staff can rename, switch off and add categories inside their area but not move them. Warehouse scopes get their screen with inventory.

**Price approvals (Phase 6):** Store Staff with `price.update.propose` file a request (`admin_approvals`, action `price.update`, one open request per variant, expiring after `security.approval_ttl_hours`). Admins holding `price.update` for the product's categories approve or reject it at `/admin/approvals`; the requester can never decide their own request (service check and database CHECK). An approved change is applied in the same transaction with the approver as `product_prices.changed_by` and the request in `approval_id`; the write itself checks that the price is still the one the requester saw (a conditional UPDATE), and if it changed the request is marked failed instead of overwriting it. Requesters see their own requests only for products they can still view. New variants start switched off and can't be switched on before they have a price.

**Pictures (Phase 6, part 2a):** adding a product photo needs `product.update` and `media.upload` on all the product's categories; changing its description, order or main photo, or removing it, needs `product.update`. A category picture needs `category.manage` and `media.upload` on that category. A brand logo needs `brand.manage` and an **unscoped** `media.upload` (a brand has no category, so scoped Store Staff can't set logos).

## Default bundles

`SA` Super Admin, `BA` Business Admin, `ST` Store Staff. `S` = granted scoped (category or warehouse). `max` = level ceiling (1 = Super Admin only, can never be given to BA or Staff). `MFA` = step-up MFA required.

| Permission | SA | BA | ST | max | MFA |
|---|---|---|---|---|---|
| product.view / create / update | ✓ | ✓ | S | 3 | |
| product.archive | ✓ | ✓ | – | 3 | |
| product.delete_permanent | ✓ | – | – | 2 | ✓ |
| media.upload | ✓ | ✓ | S | 3 | |
| price.update | ✓ | ✓ | – | 3 | |
| price.update.propose | – | – | S | 3 | |
| discount.manage, coupon.manage | ✓ | ✓ | – | 3 | |
| category.manage | ✓ | ✓ | S | 3 | |
| brand.manage, vehicle.manage | ✓ | ✓ | ✓ | 3 | |
| compatibility.manage | ✓ | ✓ | S | 3 | |
| compatibility.verify | ✓ | ✓ | – | 3 | |
| import.run, export.run | ✓ | ✓ | – | 3 | |
| inventory.view / receive / issue / count / transfer | ✓ | ✓ | S | 3 | |
| inventory.adjust | ✓ | ✓ | – | 3 | |
| inventory.adjust.propose | – | – | S | 3 | |
| inventory.view_cost | ✓ | ✓ | – | 3 | |
| warehouse.manage | ✓ | ✓ | – | 3 | |
| order.view, order.fulfil | ✓ | ✓ | S | 3 | |
| order.view_payment | ✓ | ✓ | – | 3 | |
| order.cancel, return.manage | ✓ | ✓ | – | 3 | |
| refund.create | ✓ | ✓ | – | 3 | ✓ |
| customer.view, customer.manage | ✓ | ✓ | – | 3 | |
| accounting.view, accounting.post | ✓ | ✓ | – | 3 | |
| accounting.period_close | ✓ | ✓ | – | 3 | ✓ |
| expense.manage, income.manage | ✓ | ✓ | – | 3 | |
| report.financial, report.sales | ✓ | ✓ | – | 3 | |
| payment_provider.view | ✓ | ✓ | – | 3 | |
| payment_provider.configure | ✓ | – | – | 1 | ✓ |
| shipping.configure | ✓ | ✓ | – | 3 | |
| article.manage | ✓ | ✓ | S | 3 | |
| content.manage | ✓ | ✓ | ✓ | 3 | |
| menu.manage, banner.manage | ✓ | ✓ | – | 3 | |
| pagebuilder.edit, pagebuilder.publish, theme.manage | ✓ | – | – | 1 | |
| user.manage_staff | ✓ | ✓ | – | 2 | ✓ |
| user.manage_admins, role.manage | ✓ | – | – | 1 | ✓ |
| settings.store | ✓ | ✓ | – | 2 | |
| settings.system, settings.security, integration.manage | ✓ | – | – | 1 | ✓ |
| backup.view, deployment.view, monitoring.view, audit.view_all | ✓ | – | – | 1 | |
| backup.run, deployment.request | ✓ | – | – | 1 | ✓ |
| audit.view_business | ✓ | ✓ | – | 2 | |

Staff financial access (accounting, reports, costs, payment data) is off by default but can be granted explicitly by a Super Admin, as the brief allows ("without explicit authorization"). Staff can never receive permissions with `max ≤ 2`.
