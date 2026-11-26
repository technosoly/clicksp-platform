---
name: database-architect
description: PostgreSQL and Prisma schema design for Clicksp. Use when adding or changing tables, columns, relations, indexes, constraints, triggers, seeds or migrations, or when reviewing query performance at the schema level.
---

# Database architect

## Activation conditions
- Editing `prisma/schema*.prisma` or anything in `prisma/migrations/`.
- Adding seeds, constraints, triggers, indexes, views.
- Designing a table for a new feature.

## Purpose
A normalized, constraint-enforced PostgreSQL schema where integrity does not depend on application code alone.

## Workflow
1. Confirm the owning module and add the table to `docs/DATABASE.md` and `docs/ERD.md`.
2. Model in Prisma following `references/conventions.md`.
3. Generate the migration: `pnpm prisma migrate dev --create-only --name <verb_noun>`.
4. Edit the generated SQL to add what Prisma cannot express: CHECK constraints, partial unique indexes, trigram/GIN indexes, triggers, deferred constraint triggers, comments. Use `references/sql-patterns.md`.
5. Apply on an empty DB and on a DB at the previous migration. Both must succeed.
6. Write integration tests that prove each constraint/trigger rejects bad data.
7. For destructive changes (drop/rename column, type change) use expand → migrate data → contract across separate releases. Never drop data in the same release that stops writing it.

## Technical requirements
- Primary keys: UUIDv7 (`@db.Uuid`, generated in app or by `uuidv7()` function).
- Timestamps: `created_at`, `updated_at` as `timestamptz`; `deleted_at` only on catalog/content tables that support soft delete.
- Money: `BIGINT` Rial + `currency_code CHAR(3) DEFAULT 'IRR'` beside every amount group. Never `numeric` floats for money; never `INT` (overflow).
- Quantities: `INTEGER` with CHECK constraints (variants sold by unit). If fractional units are ever needed, add an ADR.
- Every FK indexed. Every FK has an explicit `onDelete` (default `Restrict`; `Cascade` only for pure child rows like translations).
- Unique constraints for natural keys: `(product_id, locale)` on translations, normalized `(type, value)` on product identifiers, `slug` per locale.
- Ledgers (`inventory_movements`, `accounting_entries`, `audit_logs`, `order_status_history`, `payment_transactions` once final) are append-only via trigger.
- Partial unique indexes must respect soft delete: `UNIQUE (sku) WHERE deleted_at IS NULL`.
- Snapshot columns (order items, invoices) are JSONB **plus** typed columns for fields used in queries/reports.

## Security requirements
- App DB role: `SELECT/INSERT/UPDATE/DELETE` on app tables only, no DDL, no superuser. Migration role is separate.
- No raw SQL with string interpolation; use `Prisma.sql` tagged templates.
- Seeds contain only system data (roles, permissions, locales, currencies, required settings). Never fictional business data.
- PII columns (phone, address, national ID if ever added) are listed in `docs/SECURITY.md` with retention rules.

## Expected outputs
- Prisma schema change + reviewed SQL migration.
- Updated `docs/DATABASE.md` and `docs/ERD.md` (Mermaid `erDiagram`).
- Constraint tests.

## Documentation references
- Prisma migrations: https://www.prisma.io/docs/orm/prisma-migrate
- Prisma customizing migrations: https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations
- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
- PostgreSQL triggers: https://www.postgresql.org/docs/current/plpgsql-trigger.html
- pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html

## Testing requirements
- `prisma migrate reset` + `migrate deploy` from zero in CI.
- One test per CHECK/unique/trigger proving rejection.
- Seed test asserting zero rows in all business tables after seeding.
- Query tests for heavy reads use `EXPLAIN` in a test helper to assert index usage on critical paths (product by identifier, compatibility lookup, order list).
