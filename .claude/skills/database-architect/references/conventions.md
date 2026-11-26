# Naming and modelling conventions

- Tables: `snake_case`, plural (`product_variants`). Prisma models: PascalCase singular with `@@map("product_variants")`.
- Columns: `snake_case` via `@map`. Booleans start with `is_` / `has_`.
- FK column: `<referenced_singular>_id`.
- Enums: PostgreSQL enums only for closed technical sets (`movement_type`, `order_status`). Business-editable lists are tables.
- Translations: `<entity>_translations(id, <entity>_id, locale, ...fields)` with `UNIQUE(<entity>_id, locale)`; `locale` FK to `locales(code)`.
- Status columns have a matching `*_status_history` table when transitions matter for audit.
- Polymorphic links (`seo_metadata`, `audit_logs`) use `(entity_type, entity_id)` with an index; avoid for anything needing FK integrity.
- JSONB only for: snapshots, page-builder documents (validated by Zod), audit diffs, settings values (validated per key).
