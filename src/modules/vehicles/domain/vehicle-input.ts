/**
 * Admin input rules for the motorcycle catalog: manufacturers, brands,
 * models, generations (year ranges) and variants (engine, market). Pure.
 * Error messages are translation keys under AdminVehicles.errors.
 */
import { z } from "zod";
import { cleanText, namesSchema, requiredText } from "@/lib/i18n/names";
import { parseModelYear } from "@/lib/i18n/model-year";
import { toEnDigits } from "@/lib/persian-text";

export { parseModelYear };

export const SEGMENTS = ["scooter", "moped", "underbone", "standard", "sport", "touring", "cruiser", "off_road", "dual_sport", "utility", "other"] as const;
export const STROKES = ["two_stroke", "four_stroke", "electric"] as const;
export const COOLINGS = ["air", "oil", "liquid"] as const;
export const FUEL_SYSTEMS = ["carburetor", "injection", "none"] as const;

const checkbox = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "on" || v === "true");
const uuid = (message: string) => z.string().trim().pipe(z.uuid(message));
const digits = z.union([z.number(), z.string()]).transform((v) => (typeof v === "string" ? toEnDigits(v).replace(/[,٬\s]/g, "") : String(v)));

const optionalInt = (min: number, max: number, message: string) =>
  digits.transform((v, ctx) => {
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return n;
  });

const sortOrder = optionalInt(0, 100_000, "invalid_sort").transform((v) => v ?? 0);

const year = (message: string) =>
  z.string().transform((v, ctx) => {
    const parsed = parseModelYear(v);
    if (parsed === "invalid") {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed;
  });

const names = z.object({ faName: z.string(), faSlug: z.string(), enName: z.string(), enSlug: z.string() });
const NAME_KEYS = { faName: 1, faSlug: 1, enName: 1, enSlug: 1 };
function withNames<S extends z.ZodRawShape>(base: z.ZodObject<S>) {
  return base.and(names).transform((v, ctx) => {
    const parsed = namesSchema.safeParse(v);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "invalid" });
      return z.NEVER;
    }
    const rest = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([key]) => !(key in NAME_KEYS)));
    return { ...(rest as z.output<z.ZodObject<S>>), names: parsed.data };
  });
}

export const manufacturerInputSchema = withNames(
  z.object({
    countryCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^([A-Z]{2})?$/, "invalid_country"))
      .transform((v) => v || null),
    isActive: checkbox,
    sortOrder,
  }),
);
export type ManufacturerInput = z.input<typeof manufacturerInputSchema>;
export type ManufacturerData = z.output<typeof manufacturerInputSchema>;

export const motorcycleBrandInputSchema = withNames(z.object({ manufacturerId: uuid("invalid_manufacturer"), isActive: checkbox, sortOrder }));
export type MotorcycleBrandInput = z.input<typeof motorcycleBrandInputSchema>;
export type MotorcycleBrandData = z.output<typeof motorcycleBrandInputSchema>;

export const modelInputSchema = withNames(
  z.object({
    brandId: uuid("invalid_brand"),
    segment: z
      .string()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.enum(SEGMENTS, { message: "invalid_segment" }).nullable()),
    isActive: checkbox,
    sortOrder,
  }),
);
export type ModelInput = z.input<typeof modelInputSchema>;
export type ModelData = z.output<typeof modelInputSchema>;

export const generationInputSchema = z
  .object({
    code: cleanText(50, "invalid_code").transform((v) => v || null),
    yearFrom: year("invalid_year").pipe(z.number({ message: "year_from_required" })),
    yearTo: year("invalid_year"),
  })
  .refine((v) => v.yearTo === null || v.yearTo >= v.yearFrom, { message: "invalid_year_range" });
export type GenerationInput = z.input<typeof generationInputSchema>;
export type GenerationData = z.output<typeof generationInputSchema>;

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.enum(values, { message }).nullable());

export const variantInputSchema = z
  .object({
    generationId: uuid("invalid_generation"),
    faName: requiredText(150, "fa_name_required"),
    enName: cleanText(150, "invalid_name"),
    code: cleanText(50, "invalid_code").transform((v) => v || null),
    engineDisplacementCc: optionalInt(1, 5000, "invalid_cc"),
    engineStroke: optionalEnum(STROKES, "invalid_stroke"),
    cylinders: optionalInt(1, 12, "invalid_cylinders"),
    cooling: optionalEnum(COOLINGS, "invalid_cooling"),
    fuelSystem: optionalEnum(FUEL_SYSTEMS, "invalid_fuel"),
    marketCode: cleanText(10, "invalid_market").transform((v) => v.toUpperCase() || null),
    yearFrom: year("invalid_year"),
    yearTo: year("invalid_year"),
    isActive: checkbox,
  })
  .refine((v) => v.yearFrom === null || v.yearTo === null || v.yearTo >= v.yearFrom, { message: "invalid_year_range" });
export type VariantInput = z.input<typeof variantInputSchema>;
export type VariantData = z.output<typeof variantInputSchema>;

/** "2008–2015", "2008–" ("now" label supplied by the caller). */
export function yearRange(from: number | null, to: number | null, now: string): string {
  if (from === null) return "";
  if (to === null) return `${from}–${now}`;
  return from === to ? String(from) : `${from}–${to}`;
}
