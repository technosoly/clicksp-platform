/**
 * Shipping settings typed in the admin: zones (groups of provinces), methods
 * (how parcels travel, named by the store, never a made-up carrier) and the
 * rate of each method in each zone. Amounts are typed in the store's display
 * unit and stored as integer Rial.
 */
import { z } from "zod";
import { normalizeForStorage, toEnDigits } from "@/lib/persian-text";
import { isProvinceCode } from "./provinces";

const name = (max: number, error: string) => z.string().transform((v) => normalizeForStorage(v).trim()).pipe(z.string().min(1, error).max(max, error));
const optionalText = (max: number) => z.string().transform((v) => normalizeForStorage(v).trim() || null).pipe(z.string().max(max).nullable());
const code = z.string().transform((v) => v.trim().toLowerCase()).pipe(z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, "invalid_code"));
const optionalInt = (min: number, max: number, error: string) =>
  z
    .string()
    .transform((v) => {
      const s = toEnDigits(v).trim();
      return s === "" ? null : Number(s);
    })
    .pipe(z.number(error).int(error).min(min, error).max(max, error).nullable());

export const zoneInputSchema = z.object({
  code,
  faName: name(100, "name_required"),
  enName: optionalText(100),
  provinces: z.array(z.string()).transform((list) => [...new Set(list)]).pipe(z.array(z.string().refine(isProvinceCode, "provinces_required")).min(1, "provinces_required").max(31)),
  isActive: z.boolean(),
});
export type ZoneInput = z.input<typeof zoneInputSchema>;
export type ZoneData = z.output<typeof zoneInputSchema>;

export const METHOD_KINDS = ["post", "courier", "freight", "pickup"] as const;

export const methodInputSchema = z
  .object({
    code,
    kind: z.string().pipe(z.enum(METHOD_KINDS, "invalid_kind")),
    faName: name(100, "name_required"),
    enName: optionalText(100),
    faDescription: optionalText(500),
    enDescription: optionalText(500),
    minDays: optionalInt(0, 60, "invalid_days"),
    maxDays: optionalInt(0, 60, "invalid_days"),
    sortOrder: optionalInt(0, 9999, "invalid_sort"),
    isActive: z.boolean(),
  })
  .refine((m) => m.minDays === null || m.maxDays === null || m.minDays <= m.maxDays, { message: "invalid_days" });
export type MethodInput = z.input<typeof methodInputSchema>;
export type MethodData = z.output<typeof methodInputSchema>;

/** Rate amounts stay strings here; the service parses them in the store's display unit. */
export const rateInputSchema = z
  .object({
    zoneId: z.uuid("zone_required"),
    baseAmount: z.string().min(1, "invalid_amount").max(20, "invalid_amount"),
    perKgAmount: z.string().max(20, "invalid_amount"),
    freeAbove: z.string().max(20, "invalid_amount"),
    minWeightGrams: optionalInt(0, 1_000_000, "invalid_weight"),
    maxWeightGrams: optionalInt(1, 1_000_000, "invalid_weight"),
  })
  .refine((r) => r.minWeightGrams === null || r.maxWeightGrams === null || r.minWeightGrams < r.maxWeightGrams, { message: "invalid_weight" });
export type RateInput = z.input<typeof rateInputSchema>;
