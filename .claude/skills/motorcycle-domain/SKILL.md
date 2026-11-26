---
name: motorcycle-domain
description: Motorcycle catalog hierarchy, part identifiers (OEM, manufacturer, alternative numbers) and the verifiable product–motorcycle compatibility (fitment) engine for Clicksp. Use when working on motorcycle manufacturers/brands/models/generations/variants, specifications, product compatibility, part-number search, replacement parts, or bulk CSV/Excel imports of catalog or fitment data.
---

# Motorcycle domain

## Activation conditions
- Code in `src/modules/vehicles`, `compatibility`, product identifiers in `catalog`.
- "Fits my bike" selector, compatibility filters, "my garage" (`customer_vehicles`).
- Importers for motorcycles, products or fitment.

## Purpose
Let a customer reliably find parts for their exact motorcycle, backed by data whose origin and verification status are recorded. Wrong fitment means returns and lost trust, so correctness beats coverage.

## Domain model
```
motorcycle_manufacturers (e.g. the company)
  └ motorcycle_brands (marketed brand)
      └ motorcycle_models (model name, segment)
          └ motorcycle_generations (year_from, year_to, generation code)
              └ motorcycle_variants (engine displacement cc, engine type, market, trim)
                  └ motorcycle_specifications (key, value, unit; typed)
```
- `product_compatibilities(product_variant_id, motorcycle_variant_id | motorcycle_generation_id, year_from?, year_to?, position?, notes, compatibility_source_id, verification_status, verified_by, verified_at)`
  - Link at the **most specific level known**. A generation-level link means "all variants of this generation within the year range".
  - `verification_status`: `unverified | verified | disputed | rejected`.
- `compatibility_sources(type: oem_catalog | manufacturer_doc | supplier_sheet | physical_test | customer_report, reference, url?, document_id?)`.
- `product_identifiers(product_id, variant_id?, type: sku | barcode | oem | manufacturer_pn | alternative_pn | superseded_pn, value, normalized_value, brand_id?)`.
- `product_relations(type: replacement | superseded_by | alternative | accessory | bundle_part)`.

## Domain rules
1. **Never infer compatibility** from product names, descriptions, categories or similar part numbers. Only explicit records with a source.
2. Storefront shows "fits" only for `verified` links by default. `unverified` may be shown only if the store setting allows, clearly labelled.
3. Staff-created links are always `unverified`. Verification requires `compatibility.verify` and records verifier + timestamp in `audit_logs`.
4. Identifiers are normalized (`src/lib/persian-text` digits → ASCII, uppercase, strip spaces, dashes, dots, slashes) into `normalized_value`; lookups use the normalized form. Display uses the original value.
5. No sample or fictional motorcycles, products or fitment rows in seeds, fixtures committed to production seeds, or migrations. Test fixtures are created inside tests and clearly synthetic (e.g. `TEST-MODEL-1`).
6. Year ranges: inclusive, `year_from <= year_to`, CHECK constraint; Jalali/Gregorian display handled by `persian-localization`, storage is Gregorian year.

## Workflow: import (CSV / Excel)
1. Upload file → `data_import_jobs` row (status `uploaded`), file stored in S3, never parsed in the request.
2. Worker parses (stream for CSV; `exceljs` streaming reader for XLSX), validates each row with Zod, normalizes identifiers and text.
3. **Dry run** produces a report: rows valid/invalid, creates vs updates, duplicates, unknown references. Stored on the job.
4. User with `import.run` confirms → worker applies in batches inside transactions; each row's result recorded; failures do not abort the whole job.
5. Imported compatibility is `unverified` unless the file declares a source and the importer has `compatibility.verify`.
6. Templates for each import type live in `docs/imports/` with column definitions in both languages.

## Technical requirements
- Compatibility lookup by motorcycle variant must use an index on `(motorcycle_variant_id, verification_status)` and resolve generation-level links via join; target < 50 ms for 1M links.
- Vehicle selector loads levels lazily (manufacturer → model → year → variant) via cached GET endpoints.
- Search index documents include compatible model names (both locales) for verified links.

## Security requirements
- Import files: size limit, MIME sniffing, formula-injection protection on export (prefix `=`,`+`,`-`,`@` cells with `'`).
- Scope checks: Staff can manage compatibility only for products in their categories.

## Expected outputs
- Vehicles/compatibility services and APIs, import pipeline, templates, docs in `docs/DATABASE.md` section "Motorcycle catalog".

## Documentation references
- ExcelJS: https://github.com/exceljs/exceljs
- Papa Parse (CSV): https://www.papaparse.com/docs
- Schema.org `isAccessoryOrSparePartFor`: https://schema.org/isAccessoryOrSparePartFor

## Testing requirements
- Compatibility: product ↔ many models and model ↔ many products; generation-level link with year range matches only variants in range; unverified hidden from storefront by default.
- Identifier normalization: Persian/Arabic digits, dashes, spaces, case.
- Import: dry run makes no writes; invalid rows reported with line numbers; re-running same file is idempotent; formula injection escaped on export.
- Staff-created link is `unverified`; verify requires permission and is audited.
