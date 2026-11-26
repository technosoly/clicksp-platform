/**
 * Catalog admin input rules (Phase 6): slugs, bilingual names, category,
 * brand, product, variant, price and part-number input. Pure, no I/O.
 * Error messages are translation keys under AdminCatalog.errors.
 */
import { z } from "zod";
import { MoneyError, parseMoneyInput, type DisplayUnit, type Rial } from "@/lib/money";
import { normalizeForSearch, normalizeForStorage, normalizeIdentifier, toEnDigits } from "@/lib/persian-text";

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
const cleanText = (max: number, message: string) =>
  z
    .string()
    .transform((v) => normalizeForStorage(v))
    .pipe(z.string().max(max, message));

const requiredText = (max: number, message: string) => cleanText(max, message).pipe(z.string().min(1, message));

/** Optional slug: empty means "derive it from the name". */
const slugInput = z
  .string()
  .transform((v) => slugify(v))
  .pipe(z.string().max(150, "invalid_slug").refine((v) => v === "" || SLUG_PATTERN.test(v), "invalid_slug"));

const optionalUuid = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid(message).nullable());

const checkbox = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "on" || v === "true");

const sortOrder = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? toEnDigits(v).trim() : String(v)))
  .transform((v) => (v === "" ? 0 : Number(v)))
  .pipe(z.number().int("invalid_sort").min(0, "invalid_sort").max(100_000, "invalid_sort"));

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

const namesSchema = z
  .object({
    faName: requiredText(150, "fa_name_required"),
    faSlug: slugInput,
    enName: cleanText(150, "invalid_name"),
    enSlug: slugInput,
  })
  .transform((v) => localized({ name: v.faName, slug: v.faSlug }, { name: v.enName, slug: v.enSlug }))
  .refine((rows) => rows.every((r) => r.slug !== "" && SLUG_PATTERN.test(r.slug)), "invalid_slug");

export const categoryInputSchema = z
  .object({
    parentId: optionalUuid("invalid_parent"),
    isVehicleSystem: checkbox,
    isActive: checkbox,
    sortOrder,
  })
  .and(z.object({ faName: z.string(), faSlug: z.string(), enName: z.string(), enSlug: z.string() }))
  .transform((v, ctx) => {
    const names = namesSchema.safeParse(v);
    if (!names.success) {
      ctx.addIssue({ code: "custom", message: names.error.issues[0]?.message ?? "invalid" });
      return z.NEVER;
    }
    return { parentId: v.parentId, isVehicleSystem: v.isVehicleSystem, isActive: v.isActive, sortOrder: v.sortOrder, names: names.data };
  });
export type CategoryInput = z.input<typeof categoryInputSchema>;
export type CategoryData = z.output<typeof categoryInputSchema>;

export const brandInputSchema = z
  .object({ isGenuine: checkbox, isActive: checkbox, sortOrder })
  .and(z.object({ faName: z.string(), faSlug: z.string(), enName: z.string(), enSlug: z.string() }))
  .transform((v, ctx) => {
    const names = namesSchema.safeParse(v);
    if (!names.success) {
      ctx.addIssue({ code: "custom", message: names.error.issues[0]?.message ?? "invalid" });
      return z.NEVER;
    }
    return { isGenuine: v.isGenuine, isActive: v.isActive, sortOrder: v.sortOrder, names: names.data };
  });
export type BrandInput = z.input<typeof brandInputSchema>;
export type BrandData = z.output<typeof brandInputSchema>;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface LocalizedProductText {
  locale: "fa" | "en";
  title: string;
  slug: string;
  shortDescription: string | null;
  searchTitle: string;
}

const optionalInt = (min: number, max: number, message: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? toEnDigits(v).trim() : String(v)))
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int(message).min(min, message).max(max, message).nullable());

export const productDetailsSchema = z
  .object({
    faTitle: requiredText(250, "fa_title_required"),
    faSlug: slugInput,
    faShort: cleanText(1000, "invalid_short"),
    enTitle: cleanText(250, "invalid_title"),
    enSlug: slugInput,
    enShort: cleanText(1000, "invalid_short"),
    brandId: optionalUuid("invalid_brand"),
    primaryCategoryId: z.uuid("category_required"),
    categoryIds: z.array(z.uuid("invalid_category")).max(20, "invalid_category"),
    warrantyMonths: optionalInt(0, 240, "invalid_warranty"),
  })
  .transform((v, ctx) => {
    const texts: LocalizedProductText[] = [
      { locale: "fa", title: v.faTitle, slug: v.faSlug || slugify(v.faTitle), shortDescription: v.faShort || null, searchTitle: normalizeForSearch(v.faTitle) },
    ];
    if (v.enTitle) {
      texts.push({ locale: "en", title: v.enTitle, slug: v.enSlug || slugify(v.enTitle), shortDescription: v.enShort || null, searchTitle: normalizeForSearch(v.enTitle) });
    } else if (v.enShort) {
      ctx.addIssue({ code: "custom", message: "en_title_required" });
      return z.NEVER;
    }
    if (texts.some((t) => t.slug === "" || !SLUG_PATTERN.test(t.slug))) {
      ctx.addIssue({ code: "custom", message: "invalid_slug" });
      return z.NEVER;
    }
    const categoryIds = [...new Set([v.primaryCategoryId, ...v.categoryIds])];
    return { texts, brandId: v.brandId, primaryCategoryId: v.primaryCategoryId, categoryIds, warrantyMonths: v.warrantyMonths };
  });
export type ProductDetailsInput = z.input<typeof productDetailsSchema>;
export type ProductDetails = z.output<typeof productDetailsSchema>;

/** SKU as typed and its lookup form (matches product_variants_sku_normalized_format). */
export const skuSchema = z
  .string()
  .transform((v) => normalizeForStorage(toEnDigits(v)))
  .pipe(z.string().min(1, "sku_required").max(64, "invalid_sku"))
  .transform((sku, ctx) => {
    const normalized = normalizeIdentifier(sku);
    if (normalized === "" || normalized.length > 64 || /[\s\-_./]/.test(normalized)) {
      ctx.addIssue({ code: "custom", message: "invalid_sku" });
      return z.NEVER;
    }
    return { sku, skuNormalized: normalized };
  });

export const variantDetailsSchema = z.object({
  sku: skuSchema,
  weightGrams: optionalInt(1, 10_000_000, "invalid_weight"),
  lengthMm: optionalInt(1, 100_000, "invalid_dimension"),
  widthMm: optionalInt(1, 100_000, "invalid_dimension"),
  heightMm: optionalInt(1, 100_000, "invalid_dimension"),
  minOrderQty: optionalInt(1, 100_000, "invalid_quantity").transform((v) => v ?? 1),
  maxOrderQty: optionalInt(1, 100_000, "invalid_quantity"),
  isActive: checkbox,
}).refine((v) => v.maxOrderQty === null || v.maxOrderQty >= v.minOrderQty, "invalid_quantity");
export type VariantDetailsInput = z.input<typeof variantDetailsSchema>;
export type VariantDetails = z.output<typeof variantDetailsSchema>;

/** Prices typed in the store's display unit, stored as integer Rial. */
export interface PriceChange {
  price: Rial;
  compareAtPrice: Rial | null;
}

const MAX_PRICE_RIAL = 10n ** 15n;

function parsePrice(input: string, unit: DisplayUnit): Rial | "invalid" {
  try {
    const value = parseMoneyInput(input, unit);
    return value < 0n || value > MAX_PRICE_RIAL ? "invalid" : value;
  } catch (error) {
    if (error instanceof MoneyError) return "invalid";
    throw error;
  }
}

/** Parses a price form: price required (> 0), compare-at optional and above the price. */
export function parsePriceChange(input: { price: string; compareAtPrice: string }, unit: DisplayUnit): PriceChange | { error: string } {
  const price = parsePrice(input.price, unit);
  if (price === "invalid" || price === 0n) return { error: "invalid_price" };
  if (input.compareAtPrice.trim() === "") return { price, compareAtPrice: null };
  const compareAtPrice = parsePrice(input.compareAtPrice, unit);
  if (compareAtPrice === "invalid" || compareAtPrice <= price) return { error: "invalid_compare_at" };
  return { price, compareAtPrice };
}

export const IDENTIFIER_TYPES = ["oem", "manufacturer_pn", "alternative_pn", "superseded_pn", "barcode"] as const;
export type IdentifierTypeKey = (typeof IDENTIFIER_TYPES)[number];

export const identifierInputSchema = z
  .object({
    type: z.enum(IDENTIFIER_TYPES, "invalid_identifier_type"),
    value: z
      .string()
      .transform((v) => normalizeForStorage(toEnDigits(v)))
      .pipe(z.string().min(1, "invalid_identifier").max(100, "invalid_identifier")),
    brandId: optionalUuid("invalid_brand"),
  })
  .transform((v, ctx) => {
    const normalizedValue = normalizeIdentifier(v.value);
    // Matches product_identifiers_normalized_format: no separators left, at most 100 characters.
    if (normalizedValue === "" || normalizedValue.length > 100 || /[\s\-_./]/.test(normalizedValue)) {
      ctx.addIssue({ code: "custom", message: "invalid_identifier" });
      return z.NEVER;
    }
    if (v.type === "barcode" && !/^\d{8,14}$/.test(normalizedValue)) {
      ctx.addIssue({ code: "custom", message: "invalid_barcode" });
      return z.NEVER;
    }
    return { ...v, normalizedValue };
  });
export type IdentifierInput = z.input<typeof identifierInputSchema>;

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatusKey = (typeof PRODUCT_STATUSES)[number];

/**
 * What a product needs before it can be shown to customers: a Persian title
 * (always there), an active default variant and a price above zero.
 */
export function publishProblems(product: { variants: { isDefault: boolean; isActive: boolean; price: bigint }[] }): string[] {
  const problems: string[] = [];
  const main = product.variants.find((v) => v.isDefault);
  if (!main || !main.isActive) problems.push("no_active_variant");
  else if (main.price <= 0n) problems.push("no_price");
  return problems;
}

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid";
}
