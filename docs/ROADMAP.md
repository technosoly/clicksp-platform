# Roadmap

Each phase ends with a report (what was implemented, files, tests run and results, open issues, next phase) and waits for the owner's go-ahead.

| # | Phase | Status |
|---|---|---|
| 1 | Discovery and planning: architecture, ERD, permission matrix, risks | Done (plan approved) |
| 2 | Foundation: `.claude/` skills, agents and CLAUDE.md; Next.js, TypeScript, Tailwind/shadcn tokens, i18n shell, Prisma connection, Docker, env templates, CI | Done |
| 3 | Database: full schema, SQL triggers and constraints, system roles and permissions, settings seed (no business data) | Done |
| 4 | Authentication and security: admin login with TOTP, customer SMS-code login, sessions, RBAC engine, audit and security events, first Super Admin CLI, minimal admin shell (password reset and CSP moved to Phase 5) | **In review** |
| 5 | Administration: three-level admin shell, per-role navigation, user/role/permission screens, admin password reset/change, nonce CSP on admin routes | Next |
| 6 | Business infrastructure: catalog, motorcycles, compatibility, imports, inventory, orders, payment and shipping adapters, accounting, content, search, media storage | Planned |
| 6b | Storefront: home, category, product, vehicle selector, search, cart, checkout, account | Planned |
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
