/**
 * Inventory admin input rules (Phase 6, part 2c): warehouses, storage
 * locations and manual stock movements. Pure, no I/O. Error messages are
 * translation keys under AdminInventory.errors.
 */
import { z } from "zod";
import { cleanText, requiredText } from "@/lib/i18n/names";
import { normalizeForStorage, toEnDigits } from "@/lib/persian-text";

export const WAREHOUSE_CODE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
export const LOCATION_CODE = /^[A-Z0-9][A-Z0-9_.-]{0,31}$/;
/** The location every new warehouse starts with. */
export const DEFAULT_LOCATION_CODE = "MAIN";
export const MAX_MOVEMENT_QTY = 1_000_000;

const checkbox = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "on" || v === "true");

const code = (pattern: RegExp, message: string) =>
  z
    .string()
    .transform((v) => toEnDigits(v).trim().toUpperCase())
    .pipe(z.string().regex(pattern, message));

const intIn = (min: number, max: number, message: string, fallback: number | null) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? toEnDigits(v).trim() : String(v)))
    .transform((v) => (v === "" ? fallback : Number(v)))
    .pipe(z.number(message).int(message).min(min, message).max(max, message));

const phone = z
  .string()
  .transform((v) => toEnDigits(v).replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+?\d{6,15})?$/, "invalid_phone"))
  .transform((v) => v || null);

export const warehouseInputSchema = z.object({
  code: code(WAREHOUSE_CODE, "invalid_code"),
  name: requiredText(120, "name_required"),
  city: cleanText(100, "invalid_text").transform((v) => v || null),
  address: cleanText(500, "invalid_text").transform((v) => v || null),
  phone,
  priority: intIn(0, 1000, "invalid_priority", 100),
  isActive: checkbox,
});
export type WarehouseInput = z.input<typeof warehouseInputSchema>;
export type WarehouseData = z.output<typeof warehouseInputSchema>;

export const locationInputSchema = z.object({
  code: code(LOCATION_CODE, "invalid_code"),
  description: cleanText(200, "invalid_text").transform((v) => v || null),
  isDefault: checkbox,
  isActive: checkbox,
});
export type LocationInput = z.input<typeof locationInputSchema>;
export type LocationData = z.output<typeof locationInputSchema>;

/** What a person can record by hand on the stock card. */
export const MOVEMENT_KINDS = ["receive", "issue", "adjust_plus", "adjust_minus"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const ADJUSTMENT_REASONS = ["damage", "loss", "found", "correction", "expiry", "other"] as const;

/** Permission each kind needs (on the warehouse). */
export const MOVEMENT_PERMISSION: Record<MovementKind, string> = {
  receive: "inventory.receive",
  issue: "inventory.issue",
  adjust_plus: "inventory.adjust",
  adjust_minus: "inventory.adjust",
};

export const movementInputSchema = z
  .object({
    kind: z.enum(MOVEMENT_KINDS, "invalid_kind"),
    variantId: z.uuid("invalid_variant"),
    locationId: z.uuid("invalid_location"),
    quantity: intIn(1, MAX_MOVEMENT_QTY, "invalid_quantity", null),
    reference: z
      .string()
      .transform((v) => normalizeForStorage(toEnDigits(v)))
      .pipe(z.string().max(100, "invalid_reference"))
      .transform((v) => v || null),
    reason: cleanText(500, "invalid_text").transform((v) => v || null),
    adjustmentReason: z
      .string()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.enum(ADJUSTMENT_REASONS, "invalid_adjustment_reason").nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "issue" && !v.reason) ctx.addIssue({ code: "custom", message: "reason_required" });
    if (v.kind.startsWith("adjust") && !v.adjustmentReason) ctx.addIssue({ code: "custom", message: "adjustment_reason_required" });
  });
export type MovementInput = z.input<typeof movementInputSchema>;
export type MovementData = z.output<typeof movementInputSchema>;

/** Stock that can still be sold: on hand minus what open orders hold. */
export function available(balance: { onHand: number; reserved: number }): number {
  return Math.max(0, balance.onHand - balance.reserved);
}
