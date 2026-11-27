/**
 * Returns and refunds: the rules that need no database (Phase 7).
 *
 * A customer asks to return goods from a delivered order within
 * RETURN_WINDOW_DAYS of delivery (seven days, the cooling-off period Iranian
 * consumer law gives distance sales). An admin approves or rejects the
 * request, receives the goods (putting the sellable ones back on a shelf)
 * and refunds the customer. Refunds can also be made without a return, for
 * example when a paid order can't be sent.
 */
import { divideRounded, type Rial } from "@/lib/money";

export const RETURN_WINDOW_DAYS = 7;

export const RETURN_REASONS = ["wrong_fitment", "defective", "damaged_in_transit", "wrong_item", "not_as_described", "changed_mind", "other"] as const;
export type ReturnReasonKey = (typeof RETURN_REASONS)[number];

/** Returns that still count against the ordered quantities and block a new request. */
export const OPEN_RETURN_STATUSES = ["requested", "approved", "received"] as const;

/** Manual refund methods (a gateway refund needs a real payment adapter, not built yet). */
export const REFUND_METHODS = ["bank_transfer", "cash"] as const;
export type RefundMethodKey = (typeof REFUND_METHODS)[number];

/** Order statuses in which the customer has paid and may get money back. */
export const REFUNDABLE_ORDER_STATUSES = ["paid", "processing", "delivered", "return_requested", "returned"] as const;

export function withinReturnWindow(deliveredAt: Date, now: Date): boolean {
  return now.getTime() - deliveredAt.getTime() <= RETURN_WINDOW_DAYS * 24 * 60 * 60_000;
}

/** How many of each line can still be returned, given what open or finished returns already cover. */
export function returnableQuantities(
  items: readonly { id: string; quantity: number }[],
  returned: readonly { orderItemId: string; quantity: number }[],
): Map<string, number> {
  const taken = new Map<string, number>();
  for (const r of returned) taken.set(r.orderItemId, (taken.get(r.orderItemId) ?? 0) + r.quantity);
  return new Map(items.map((i) => [i.id, Math.max(0, i.quantity - (taken.get(i.id) ?? 0))]));
}

/**
 * What the returned goods cost the customer: each line's paid total
 * (after its discount and tax) in proportion to the units returned, rounded
 * down to the Rial. Shipping is not included; the admin can refund more.
 */
export function returnValue(lines: readonly { lineTotal: Rial; ordered: number; returned: number }[]): Rial {
  let total = 0n;
  for (const l of lines) {
    if (l.returned <= 0 || l.ordered <= 0) continue;
    total += divideRounded(l.lineTotal * BigInt(l.returned), BigInt(l.ordered), "down");
  }
  return total;
}
