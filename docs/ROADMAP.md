# Roadmap

Each phase ends with a report (what was implemented, files, tests run and results, open issues, next phase) and waits for the owner's go-ahead.

| # | Phase | Status |
|---|---|---|
| 1 | Discovery and planning: architecture, ERD, permission matrix, risks | Done (plan approved) |
| 2 | Foundation: `.claude/` skills, agents and CLAUDE.md; Next.js, TypeScript, Tailwind/shadcn tokens, i18n shell, Prisma connection, Docker, env templates, CI | Done |
| 3 | Database: full schema, SQL triggers and constraints, system roles and permissions, settings seed (no business data) | Done |
| 4 | Authentication and security: admin login with TOTP, customer SMS-code login, sessions, RBAC engine, audit and security events, first Super Admin CLI, minimal admin shell (password reset and CSP moved to Phase 5) | Done |
| 5 | Administration: three-level admin shell, per-role navigation and 403 pages, admin accounts (invite links, roles, disable, password reset links, two-factor reset, sessions), role and permission editor, own password and devices, audit log viewer, recovery CLI, nonce CSP on admin routes | Done |
| 6 | Business infrastructure, in parts. **Part 1 (done):** catalog admin (categories, brands, products, variants, prices, part numbers), Store Staff category scopes, price-change approvals. **Part 2a (done):** image storage, product photos, brand logos, category pictures, placeholders. **Part 2b (done):** motorcycle catalog and fitment links with sources and verification. **Part 2c (in review):** warehouses and locations, Store Staff warehouse scopes, stock card (receive, issue, adjust, history) and inventory overview. **Content part 1 (done):** information pages (about, contact, shipping, returns, terms, privacy) with revisions, on the storefront and in the footer. **Jobs and search (done):** background jobs (pg-boss) delivering the outbox and expiring unpaid orders; Meilisearch product index kept current from the outbox, with the database search as fallback. **Product import (done):** CSV upload, dry-run report, confirmed import in the background. **Transfers and counts (done):** stock transfers between warehouses (draft, on the way, received) and stock counts applied by an admin. **Returns and refunds (done).** **Accounting (done):** chart of accounts, posting accounts, periods, journal with manual entries and reversals, expenses and income, reports, automatic postings of paid orders and refunds. **Website content (in review):** articles (blog), header and footer menus, home page banners in a slider. **Next parts:** staff adjustment proposals | In progress |
| 6b | Storefront, in parts. **Part 1 (in review):** home, category, product, search, motorcycles and the parts that fit a model (verified fitment only), stock shown as in stock / low / out. **Part 2 (in review):** guest and customer carts. **Part 3 (in review):** shipping settings, checkout, order placement with stock holds, the customer's own orders. **Part 4 (in review):** admin order list and screen, cancelling unpaid orders. **Part 5 (in review):** customer account: name and saved addresses. **Part 6 (in review):** online payment through a gateway adapter (test gateway only until the store's Zarinpal or Zibal credentials arrive). **Part 7 (in progress):** fulfilment: pack, ship with a tracking code (stock leaves as sales, one shipment per warehouse), mark delivered. **Part 8 (in review):** returns (customer request within 7 days, approve or reject, receive back on sale) and manual refunds (bank transfer or cash). **Next parts:** the real gateway adapter and gateway refunds | In progress |
| 7 | Page builder: component registry, editor, preview, revisions, rollback | Planned |
| 8 | Skills and agents refresh to match the real implementation | Planned |
| 9 | Quality and security: full test run, security review, DB integrity and currency audit | Planned |
| 10 | Deployment preparation: staging/production docs, backup and restore drill, final audit | Planned |

## Open decisions (owner)

- Hosting provider and domain (Iranian VPS recommended). Pluggable; not needed until Phase 10.
- SMS provider for customer OTP login. The adapter interface exists (Phase 4); phone sign-in shows "not available yet" until a provider is implemented from its official docs with the owner's account.
- Payment gateway (Zarinpal, Zibal, ...) and merchant account. Real adapters only with real sandbox credentials.
- Default storefront price unit. Seeded as the `store.display_currency_unit` setting = `toman`; storage is always Rial. Business Admin can change it.
- Guest checkout: seeded off (`checkout.guest_checkout_enabled`).
- Chart of accounts, tax rules and posting mappings: to be defined with the owner's accountant (nothing seeded).
