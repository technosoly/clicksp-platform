# Persian text normalization rules

Apply in this order. The same function is used for indexing and for queries.

1. Unicode NFKC.
2. Arabic Yeh `ي` (U+064A) and Alef Maksura `ى` (U+0649) → Persian Yeh `ی` (U+06CC).
3. Arabic Kaf `ك` (U+0643) → Persian Keheh `ک` (U+06A9).
4. Teh Marbuta `ة` → `ه`; Heh with Yeh above `ۀ` → `ه` + optional (keep a search-only variant).
5. Remove Arabic diacritics (U+064B–U+065F, U+0670) and tatweel `ـ` (U+0640).
6. Digits: Persian `۰-۹` (U+06F0–U+06F9) and Arabic-Indic `٠-٩` (U+0660–U+0669) → ASCII `0-9`.
7. Half-space: ZWNJ (U+200C). For **search** documents and queries, produce both a ZWNJ-removed form and a space form, e.g. `می‌خواهم` → `میخواهم` and `می خواهم`. For **display/storage of titles**, keep the original.
8. Collapse whitespace; trim.
9. Lowercase Latin.
10. Identifier mode only (SKU/OEM/barcode): additionally remove spaces, `-`, `_`, `.`, `/` and uppercase.

Spelling variants (e.g. common alternate spellings of part names, transliterations like "پیستون" / "piston") are kept in an admin-managed synonyms table pushed to Meilisearch synonyms; do not hardcode business vocabulary.
