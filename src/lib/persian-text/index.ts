/**
 * Persian text normalization: the single implementation used for search
 * indexing, search queries, imports and identifier lookup.
 * Rules: .claude/skills/persian-localization/references/normalization.md
 */

const ARABIC_YEH = /[يى]/g; // ي ى
const ARABIC_KAF = /ك/g; // ك
const TEH_MARBUTA = /ة/g; // ة
const HEH_WITH_YEH_ABOVE = /ۀ/g; // ۀ
const DIACRITICS_AND_TATWEEL = /[ً-ٰٟـ]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const ZWNJ = /‌/g;
const WHITESPACE = /\s+/g;
const IDENTIFIER_SEPARATORS = /[\s\-_./]+/g;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9. Other text is unchanged. */
export function toEnDigits(input: string): string {
  return input
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** ASCII digits to Persian digits (for display only). */
export function toFaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/** Character-level normalization shared by every mode (steps 1-6). */
function normalizeCharacters(input: string): string {
  return toEnDigits(
    input
      .normalize("NFKC")
      .replace(ARABIC_YEH, "ی")
      .replace(ARABIC_KAF, "ک")
      .replace(TEH_MARBUTA, "ه")
      .replace(HEH_WITH_YEH_ABOVE, "ه")
      .replace(DIACRITICS_AND_TATWEEL, ""),
  );
}

/**
 * Canonical form for search documents and queries.
 * ZWNJ half-spaces are removed (joined form); use {@link searchVariants}
 * when the spaced form must also be indexed or queried.
 */
export function normalizeForSearch(input: string): string {
  return normalizeCharacters(input).replace(ZWNJ, "").replace(WHITESPACE, " ").trim().toLowerCase();
}

/**
 * Both half-space variants of a text: joined (ZWNJ removed) and spaced
 * (ZWNJ replaced by a space). Returns one entry when they are identical.
 */
export function searchVariants(input: string): string[] {
  const base = normalizeCharacters(input);
  const joined = base.replace(ZWNJ, "").replace(WHITESPACE, " ").trim().toLowerCase();
  const spaced = base.replace(ZWNJ, " ").replace(WHITESPACE, " ").trim().toLowerCase();
  return joined === spaced ? [joined] : [joined, spaced];
}

/**
 * Normalization for display/storage: fixes Arabic letters, keeps ZWNJ and
 * the original digits and case, collapses whitespace.
 */
export function normalizeForStorage(input: string): string {
  return input
    .normalize("NFKC")
    .replace(ARABIC_YEH, "ی")
    .replace(ARABIC_KAF, "ک")
    .replace(/[ \t ]+/g, " ")
    .trim();
}

/**
 * Identifier mode for SKU, OEM, manufacturer part numbers and barcodes:
 * digits to ASCII, separators removed, uppercase.
 * "۱۲۳-ab 45" -> "123AB45"
 */
export function normalizeIdentifier(input: string): string {
  return normalizeCharacters(input).replace(ZWNJ, "").replace(IDENTIFIER_SEPARATORS, "").toUpperCase();
}
