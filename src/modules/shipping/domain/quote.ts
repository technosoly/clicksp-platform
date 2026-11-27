/** Shipping cost of one rate for a parcel (pure; integer Rial). */
import { add, multiply, ZERO, type Rial } from "@/lib/money";

export interface RateRule {
  baseAmount: Rial;
  perKgAmount: Rial;
  freeAboveSubtotal: Rial | null;
  minWeightGrams: number;
  maxWeightGrams: number | null;
}

/** Whether the rate covers a parcel of this weight (min inclusive, max inclusive). */
export function rateCovers(rate: RateRule, weightGrams: number): boolean {
  return weightGrams >= rate.minWeightGrams && (rate.maxWeightGrams === null || weightGrams <= rate.maxWeightGrams);
}

/**
 * Base amount plus the per-kilogram amount for every started kilogram; free
 * when the goods subtotal reaches the rate's free-shipping threshold.
 */
export function shippingCost(rate: RateRule, weightGrams: number, goodsSubtotal: Rial): Rial {
  if (rate.freeAboveSubtotal !== null && goodsSubtotal >= rate.freeAboveSubtotal) return ZERO;
  const kilos = Math.ceil(Math.max(0, weightGrams) / 1000);
  return add(rate.baseAmount, multiply(rate.perKgAmount, kilos));
}
