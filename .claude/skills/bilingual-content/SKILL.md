---
name: bilingual-content
description: Data model and workflow for Persian/English content in Clicksp — translation tables for products, categories, brands, articles, pages, menus and SEO metadata, fallbacks, completeness checks and admin editing of both languages. Use when adding a translatable field or entity, rendering localized business content, or building admin forms with fa/en tabs.
---

# Bilingual content

## Activation conditions
- New entity or field that customers read (titles, descriptions, slugs, SEO text, alt text).
- Rendering business records on the storefront.
- Admin forms for translatable entities.

## Purpose
Keep translatable text separate from business records, make missing translations visible, and render a predictable fallback. (UI chrome strings are handled by `persian-localization` message files; this skill covers **data**.)

## Rules
1. Non-translatable data (SKU, price, weight, status, FKs) lives on the base table. Translatable text lives in `<entity>_translations(<entity>_id, locale, ...)` with `UNIQUE(<entity>_id, locale)`.
2. Persian (`fa`) translation is **required** to publish an entity; English is optional but tracked.
3. Slugs are per locale (`slug` on the translation row), unique per locale per entity type.
4. Fallback when `en` is missing: show `fa` content with `lang="fa" dir="rtl"` on that element, and mark the page `noindex` for the `en` URL **or** omit the `en` alternate (decided per entity type in `ecommerce-seo`). Never machine-translate silently.
5. Search documents carry both locales' normalized text.
6. Rich text is stored as validated structured JSON (TipTap/ProseMirror schema), never raw HTML.
7. Image `alt` text is translatable (`product_images` has translations or an `alt` JSON per locale validated by Zod).

## Workflow
1. Add base column(s) vs translation column(s) per rule 1 (with `database-architect`).
2. Repository functions return `{ ...base, t: { fa, en? } }` or a resolved view for a requested locale with `isFallback` flag.
3. Admin form: locale tabs (`فارسی` / `English`), a completeness badge per locale, Zod schema requiring `fa` fields.
4. Admin list views show a "missing English" filter.
5. Revalidate cache tags for both locales on save.

## Technical requirements
- Helper `resolveTranslation(rows, locale, fallback = 'fa')` in `src/lib/i18n`.
- Query only needed locales (`where: { locale: { in: [locale, 'fa'] } }`).
- Sanitizer/renderer for rich text JSON with an allow-list of nodes and marks; links restricted to `http(s)`, `mailto`, `tel`, and relative paths.

## Security requirements
- Rich text renderer must not allow raw HTML nodes, `javascript:` links or inline styles.
- Staff edits scoped by category apply to translations too.

## Expected outputs
- Translation tables, resolver helper, admin locale tabs component, completeness indicators.

## Documentation references
- TipTap JSON content: https://tiptap.dev/docs/editor/core-concepts/schema
- next-intl: https://next-intl.dev/docs

## Testing requirements
- Publishing without `fa` translation fails validation.
- `en` request with missing translation returns fallback with `isFallback = true` and correct SEO behaviour.
- Rich text with `<script>`, `javascript:` link or unknown node is rejected/stripped.
- Slug uniqueness per locale.
