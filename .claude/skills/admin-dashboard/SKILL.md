---
name: admin-dashboard
description: Clicksp administration panel for the three admin levels (Super Admin, Business Admin, Store Staff) — permission-gated layout and navigation, data tables, forms, confirmations, approvals inbox, audit views and technical screens. Use when building or changing any page under the admin area.
---

# Admin dashboard

## Activation conditions
- Files under `app/[locale]/admin/` or `src/components/admin/`.
- Adding an admin screen, menu item, bulk action or report view.

## Purpose
One admin application whose navigation and actions adapt to each user's **effective permissions**, with the server enforcing every rule.

## Structure
```
admin/
  layout.tsx            loads actor; redirects if not admin; requires MFA enrolment for levels 1–2
  (dashboard)/          KPIs filtered by permissions
  catalog/  products, categories, brands, manufacturers, attributes, imports
  vehicles/ motorcycle catalog, compatibility, verification queue
  inventory/ warehouses, balances, receive, issue, transfer, counts, alerts
  sales/    orders, returns, refunds, customers, coupons, discounts
  finance/  accounts, journals, income, expenses, periods, reconciliation, reports
  shipping/ providers, methods, zones, rates, shipments
  content/  articles, pages (content only), menus, banners, media
  builder/  page builder, templates, components, themes          (Super Admin)
  people/   users, roles, permissions, scopes, sessions          (per permission)
  approvals/ pending approvals inbox
  system/   settings, integrations, security, backups, deployments, releases, monitoring, audit, logs, jobs (Super Admin)
```

## Workflow
1. Each nav item declares `requires: PermissionKey[]`. The nav renders only items whose permissions the actor holds (UI convenience only).
2. Each page's server component calls the service; the service enforces `authorize()`. Direct URL access without permission returns the localized 403 page.
3. Mutations through Server Actions that call services; return typed results; show toasts; revalidate tags.
4. Destructive actions: confirmation dialog stating the effect; permanent deletes require typing the entity name + recent MFA.
5. Tables: server-side pagination, sorting, filtering via URL params; column visibility respects permissions (e.g. cost and margin columns hidden without `report.financial`, and **not sent** from the server).
6. Approvals inbox lists `admin_approvals` the actor can approve, showing a diff of the proposed change.
7. Developer functions (deployments, releases, rollback requests) show history from `deployment_records`/`release_versions` and allow **requesting** an action via a narrowly scoped CI trigger. No terminal, no file editor, no SQL console, no secret values displayed (only "configured / not configured").

## Technical requirements
- shadcn/ui Data Table pattern with TanStack Table only in client islands; data fetched server-side.
- Jalali dates in `fa` (from `persian-localization`).
- All forms: Zod schemas shared with services; field-level localized errors.
- Bulk actions processed as background jobs when > 100 rows, with progress.

## Security requirements
- Server never sends fields the actor may not see (filter in service/DTO, not in the component).
- Session idle timeout warning; re-auth for sensitive actions.
- CSP-compatible: no inline scripts.

## Expected outputs
- Admin pages with per-permission navigation, shared admin components, docs of screens per role in `docs/RBAC.md`.

## Documentation references
- shadcn/ui Data Table: https://ui.shadcn.com/docs/components/data-table
- TanStack Table: https://tanstack.com/table/latest
- Next.js Server Actions: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

## Testing requirements
- Playwright for **each** admin level: login (with TOTP), visible navigation matches matrix, allowed actions succeed, forbidden URLs return 403, forbidden fields absent from HTML and network payloads.
- Approval flow: Staff proposes price change → Business Admin approves → price updated and both audited.
- Permanent delete requires MFA and is unavailable to Business Admin and Staff.
