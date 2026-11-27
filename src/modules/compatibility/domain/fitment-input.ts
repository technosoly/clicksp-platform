/**
 * Fitment (product ↔ motorcycle) input rules. Pure. A link targets either a
 * motorcycle variant or a whole generation (optionally narrowed to years),
 * always cites a source, and starts unverified. Error messages are
 * translation keys under AdminFitment.errors.
 */
import { z } from "zod";
import { cleanText, requiredText } from "@/lib/i18n/names";
import { toEnDigits } from "@/lib/persian-text";
import { parseModelYear } from "@/lib/i18n/model-year";

export const POSITIONS = ["any", "front", "rear", "left", "right", "front_left", "front_right", "rear_left", "rear_right", "upper", "lower"] as const;
export const SOURCE_TYPES = ["oem_catalog", "manufacturer_doc", "supplier_sheet", "physical_test", "customer_report"] as const;
export const VERIFICATION_STATUSES = ["unverified", "verified", "disputed", "rejected"] as const;
export type VerificationStatusKey = (typeof VERIFICATION_STATUSES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "v:<variant id>" or "g:<generation id>" from the motorcycle picker. */
export function parseTarget(value: string): { variantId: string } | { generationId: string } | null {
  const [kind, id] = value.split(":");
  if (!id || !UUID.test(id)) return null;
  if (kind === "v") return { variantId: id };
  if (kind === "g") return { generationId: id };
  return null;
}

const year = z.string().transform((v, ctx) => {
  const parsed = parseModelYear(v);
  if (parsed === "invalid") {
    ctx.addIssue({ code: "custom", message: "invalid_year" });
    return z.NEVER;
  }
  return parsed;
});

export const newSourceSchema = z.object({
  type: z.enum(SOURCE_TYPES, { message: "invalid_source_type" }),
  title: requiredText(200, "source_title_required"),
  reference: cleanText(200, "invalid_reference").transform((v) => v || null),
  url: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.url({ protocol: /^https?$/, message: "invalid_url" }).max(500, "invalid_url").nullable()),
});
export type NewSource = z.output<typeof newSourceSchema>;

export const fitmentInputSchema = z
  .object({
    target: z.string().transform((v, ctx) => {
      const t = parseTarget(v);
      if (!t) {
        ctx.addIssue({ code: "custom", message: "motorcycle_required" });
        return z.NEVER;
      }
      return t;
    }),
    yearFrom: year,
    yearTo: year,
    position: z.enum(POSITIONS, { message: "invalid_position" }),
    quantity: z
      .string()
      .transform((v) => toEnDigits(v).trim())
      .transform((v, ctx) => {
        if (v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 100) {
          ctx.addIssue({ code: "custom", message: "invalid_quantity" });
          return z.NEVER;
        }
        return n;
      }),
    notes: cleanText(1000, "invalid_notes").transform((v) => v || null),
    sourceId: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.uuid("invalid_source").nullable()),
  })
  .refine((v) => v.yearFrom === null || v.yearTo === null || v.yearTo >= v.yearFrom, { message: "invalid_year_range" });
export type FitmentInput = z.input<typeof fitmentInputSchema>;
export type FitmentData = z.output<typeof fitmentInputSchema>;

/** Statuses a verifier may set (verified needs compatibility.verify). */
export const DECISIONS = ["verified", "disputed", "rejected", "unverified"] as const;
