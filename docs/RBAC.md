# Roles and permissions

What is implemented (Phase 3): the data model, the permission catalogue, the default bundles of the three admin levels, and the database-level escalation guards. The `authorize()` engine, sessions, MFA and the admin screens come in Phase 4 and 5.

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

Further guards (only level 1 can assign level 1 roles, nobody grants a permission they lack, nobody edits their own roles) are service rules in Phase 4.

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
