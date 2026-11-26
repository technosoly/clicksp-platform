/**
 * Bilingual names and URL slugs shared by translatable admin entities
 * (categories, brands, motorcycles). Pure, no I/O. Error messages are
 * translation keys.
 */
import { z } from "zod";
import { normalizeForSearch, normalizeForStorage, toEnDigits } from "@/lib/persian-text";

/** Matches the *_translations slug_format CHECK constraints. */
export const SLUG_PATTERN = /^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$/;

/**
 * A URL slug from a name: Persian letters are kept, digits become ASCII,
 * Latin letters lower-case, everything else (spaces, half-spaces,
 * punctuation) becomes a single dash. "لنت ترمز‌جلو CG-125" -> "لنت-ترمز-جلو-cg-125".
 */
export function slugify(input: string): string {
  return toEnDigits(normalizeForStorage(input))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // diacritics, tatweel
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/[،؛؟٪-٭۔]/g, "-") // Arabic punctuation inside the letter block
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 150)
    .replace(/-$/, "");
}

/** Text typed by an admin: Arabic letters fixed, whitespace collapsed. */
export const cleanText = (max: number, message: string) =>
  z
    .string()
    .transform((v) => normalizeForStorage(v))
    .pipe(z.string().max(max, message));

export const requiredText = (max: number, message: string) => cleanText(max, message).pipe(z.string().min(1, message));

/** Optional slug: empty means "derive it from the name". */
export const slugInput = z
  .string()
  .transform((v) => slugify(v))
  .pipe(z.string().max(150, "invalid_slug").refine((v) => v === "" || SLUG_PATTERN.test(v), "invalid_slug"));

/** One locale's name and slug. Persian is required, English optional. */
export interface LocalizedName {
  locale: "fa" | "en";
  name: string;
  slug: string;
  searchName: string;
}

function localized(fa: { name: string; slug: string }, en: { name: string; slug: string }): LocalizedName[] {
  const rows: LocalizedName[] = [{ locale: "fa", name: fa.name, slug: fa.slug || slugify(fa.name), searchName: normalizeForSearch(fa.name) }];
  if (en.name) rows.push({ locale: "en", name: en.name, slug: en.slug || slugify(en.name), searchName: normalizeForSearch(en.name) });
  return rows;
}

export const namesSchema = z
  .object({
    faName: requiredText(150, "fa_name_required"),
    faSlug: slugInput,
    enName: cleanText(150, "invalid_name"),
    enSlug: slugInput,
  })
  .transform((v) => localized({ name: v.faName, slug: v.faSlug }, { name: v.enName, slug: v.enSlug }))
  .refine((rows) => rows.every((r) => r.slug !== "" && SLUG_PATTERN.test(r.slug)), "invalid_slug");
