---
name: page-builder
description: Safe visual page builder for Clicksp Super Admins — structured JSON page documents validated by Zod against a code-defined component registry, drafts, preview, publish, revision history, rollback, templates, navigation and footer, bilingual content. Use when adding builder components, changing the page document schema, the editor UI, rendering of builder pages, or revision/publish logic.
---

# Page builder

## Activation conditions
- Code in `src/modules/pagebuilder`, `app/[locale]/admin/builder/`, builder renderers.
- Adding a section type (hero, banner carousel, category grid, product rail, rich text, etc.).

## Purpose
Let the Super Admin compose and publish pages without touching code, with zero possibility of injecting executable code. Real code changes go through Git and the controlled deployment pipeline, never through the builder.

## Model
- `pages(id, key, type: home | landing | custom, status)` + `page_revisions(id, page_id, version, document JSONB, status: draft | published | archived, created_by, created_at, published_by, published_at, note)`.
- `page_templates(document JSONB)`; `page_builder_components(type, enabled, settings)` controls which registry components are enabled.
- `menus`, `banners` are reusable data referenced by ID from documents.
- Exactly one `published` revision per page (partial unique index).

## Document schema
See `references/document-schema.md`. Summary: a page is `{ version, sections: Section[] }`; each section is `{ id, type, props, visibility: { breakpoints, locales }, content: { fa, en? } }`. `type` must exist in the **component registry** (`src/modules/pagebuilder/registry.ts`), which maps type → Zod props schema + React Server Component renderer.

## Workflow: add a component
1. Write the RSC renderer in `src/components/builder/<Type>.tsx` (uses design tokens; no client JS unless essential).
2. Write its Zod props schema (all strings length-limited; URLs restricted to relative or allow-listed hosts; references by ID resolved server-side).
3. Register in `registry.ts` with editor metadata (label fa/en, icon, default props).
4. Add tests (schema accept/reject, render snapshot both locales).

## Workflow: edit → publish
1. Editor loads the latest draft (or creates one from the published revision).
2. Each save validates the whole document with Zod server-side; invalid → rejected with path-level errors.
3. Preview renders the draft at `/[locale]/preview/<token>` (signed, short-lived, `noindex`, admin session required).
4. Publish: new revision `published`, previous published → `archived`; cache tags revalidated; audit log.
5. Rollback: publish a copy of an older revision as a new version (history is never rewritten).

## Technical requirements
- Editor UI: client component with drag-and-drop ordering (`dnd-kit`), property forms generated from registry metadata, side-by-side fa/en content, breakpoint preview (mobile/tablet/desktop).
- Storefront rendering resolves product/category references in one batched query per page.
- Document size limit (e.g. 256 KB) and max sections.

## Security requirements
- **Never** execute JavaScript, render raw HTML, accept `<script>`, `on*` attributes, `style` strings, `javascript:`/`data:` URLs, or arbitrary CSS classes from documents.
- Colours/spacing chosen from token enums, not free CSS.
- Only `pagebuilder.edit` / `pagebuilder.publish` (Super Admin by default) may access; Business Admin and Staff cannot reach builder routes or APIs.
- The builder has no access to files, Git, environment variables or the database beyond its own tables.

## Expected outputs
- Registry, schemas, editor, renderer, revision services, docs in `docs/ARCHITECTURE.md` section "Page builder".

## Documentation references
- Zod: https://zod.dev
- dnd-kit: https://docs.dndkit.com
- Next.js draft mode / preview: https://nextjs.org/docs/app/building-your-application/configuring/draft-mode
- OWASP XSS Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

## Testing requirements
- Schema rejects unknown types, script payloads, `javascript:` URLs, oversize docs, invalid references.
- Publish/rollback creates new revisions, keeps exactly one published.
- Preview requires admin session and is `noindex`.
- Business Admin and Staff get 403 on builder pages and APIs.
- Rendered page in `fa` and `en` matches snapshot; RTL ordering correct.
