---
name: persian-localization
description: Persian-first localization for Clicksp — fa/en routing, RTL/LTR layout, Vazirmatn typography, Jalali and Gregorian dates, Persian and English digits, Rial/Toman money display via the central money module, and Persian text normalization for search and identifiers. Use for any user-facing text, date, number or price display, form validation messages, or text normalization.
---

# Persian localization

## Activation conditions
- Any UI string, date, number, price, phone number or form message.
- Code in `src/lib/i18n`, `src/lib/money`, `src/lib/persian-text`, `messages/*.json`.
- Search indexing/query code, importers, identifier lookup.

## Purpose
Persian is the default experience, English is first-class, and money/text handling is identical everywhere because it happens in exactly one place.

## Workflow: locale and direction
- next-intl with locales `['fa', 'en']`, default `fa`, prefix always (`/fa/...`, `/en/...`). Root `/` redirects by cookie, then `Accept-Language`, then `fa`.
- `<html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>` set in `app/[locale]/layout.tsx`.
- Layout uses logical utilities only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). Icons that imply direction (arrows, chevrons) flip with `rtl:rotate-180`.
- Mixed content (Latin part numbers inside Persian text) wrapped in `<bdi>` or `dir="ltr"` spans to avoid bidi scrambling.

## Typography
- Vazirmatn variable font, self-hosted via `next/font/local` (subset Arabic + Latin), `font-display: swap`. No Google Fonts or external CDN.
- English uses the same family's Latin glyphs or a bundled Latin font set in design tokens; line-height ≥ 1.7 for Persian body text.

## Technical requirements: money (`src/lib/money`) — the only place money is converted or formatted
```ts
type Rial = bigint
toman(r: Rial): { whole: bigint; remainderRial: bigint }   // 1 Toman = 10 Rial
fromToman(t: bigint): Rial
formatMoney(r: Rial, opts: { unit: 'toman' | 'rial'; digits: 'fa' | 'en'; locale: 'fa' | 'en' }): string
applyPercent(r: Rial, basisPoints: number, rounding: RoundingMode): Rial
sum(...r: Rial[]): Rial
```
- Store setting `display_currency_unit` (`toman` default, owner-configurable) decides the unit shown; formatting uses thousands separators (`٬` for fa digits, `,` for en) and the localized label (`تومان` / `Toman`, `ریال` / `Rial`).
- If a Rial amount is not divisible by 10 and the unit is Toman, show the exact value per the rounding setting; never silently drop Rial internally.
- Components receive `Rial` and call `formatMoney`. **Never** divide/multiply by 10 or call `toLocaleString` on money in components (lint rule).

## Digits and numbers
- `toFaDigits`, `toEnDigits` in `src/lib/persian-text`. Persian UI shows Persian digits for prices, quantities and dates; SKU/OEM/barcodes stay in their original Latin form.
- All numeric **inputs** accept Persian, Arabic-Indic and ASCII digits and normalize to ASCII before Zod validation.

## Dates
- Storage: UTC `timestamptz`. Display: `Asia/Tehran` time zone.
- Jalali: `Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', ... })`. Gregorian for `en`. Admin can toggle calendar per user preference.
- Date pickers in admin: Jalali picker for `fa`; values converted to ISO before submit.

## Text normalization (`src/lib/persian-text/normalize.ts`)
Rules in `references/normalization.md`. Used by search indexing and querying, importers, identifier `normalized_value`, slug generation.

## Validation messages
- Zod error map localized via next-intl (`src/lib/i18n/zod-error-map.ts`). Every schema uses message keys, not literal strings.

## Security requirements
- Never render translation strings as HTML; rich messages use next-intl rich text with React components.
- Slugs are generated server-side from normalized text and are ASCII-safe or properly percent-encoded Persian.

## Expected outputs
- Messages files `messages/fa.json`, `messages/en.json` (same keys; CI checks parity).
- Money, digits, date, normalization utilities with tests.

## Documentation references
- next-intl App Router: https://next-intl.dev/docs/getting-started/app-router
- Intl.DateTimeFormat calendars: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
- Vazirmatn: https://github.com/rastikerdar/vazirmatn
- Tailwind RTL/logical properties: https://tailwindcss.com/docs/padding#using-logical-properties

## Testing requirements
- Money: Rial→Toman, Toman→Rial, formatting both digit sets and units, separators, large values (> 2^53 Rial), negative values (refund display), percent discount rounding.
- Order/shipping/refund totals use only money functions (tested in sales/accounting suites).
- Normalization: ي→ی, ك→ک, Persian/Arabic digits→ASCII, ZWNJ variants, whitespace, tatweel removal.
- Messages parity test: fa and en have identical key sets.
- Playwright: `/fa` has `dir=rtl`, `/en` has `dir=ltr`; language switch keeps the same page; screenshots at 360 px width in both directions.
