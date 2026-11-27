/**
 * Cart rules (pure, no I/O). Prices and stock always come from the server at
 * the moment of reading; the cart stores only variant ids and quantities.
 */
import { z } from "zod";

/** Most different parts in one cart. */
export const MAX_CART_LINES = 30;
/** Most of one part in one cart (the database allows up to 999). */
export const MAX_LINE_QUANTITY = 99;
/** A guest cart is kept this long after its last change. */
export const GUEST_CART_DAYS = 30;

export const cartLineInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(MAX_LINE_QUANTITY),
});

export type LineProblem = "unavailable" | "out_of_stock" | "not_enough_stock" | "below_minimum" | "above_maximum";

export interface LineFacts {
  quantity: number;
  /** null when the part can't be bought now (unpublished, switched off, no price). */
  variant: { minQty: number; maxQty: number | null } | null;
  /** Sellable stock now. */
  available: number;
}

/** What stops a cart line from being ordered as it is, if anything. */
export function lineProblem(line: LineFacts): LineProblem | null {
  if (!line.variant) return "unavailable";
  if (line.available <= 0) return "out_of_stock";
  if (line.quantity < line.variant.minQty) return "below_minimum";
  if (line.variant.maxQty !== null && line.quantity > line.variant.maxQty) return "above_maximum";
  if (line.quantity > line.available) return "not_enough_stock";
  return null;
}

/** The quantity a new add should end at: within the part's limits and the cart's. */
export function clampQuantity(wanted: number, variant: { minQty: number; maxQty: number | null }): number {
  const upper = Math.min(MAX_LINE_QUANTITY, variant.maxQty ?? MAX_LINE_QUANTITY);
  return Math.max(Math.min(wanted, upper), Math.min(variant.minQty, upper));
}
