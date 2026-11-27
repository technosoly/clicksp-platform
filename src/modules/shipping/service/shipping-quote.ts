import "server-only";
import { db } from "@/lib/db";
import type { Rial } from "@/lib/money";
import { isProvinceCode } from "../domain/provinces";
import { rateCovers, shippingCost } from "../domain/quote";
import { methodsForProvince } from "../repo/shipping-repo";

/**
 * Delivery options for a parcel going to a province: the store's active
 * methods with a rate there, priced on the server from the rate tables. Public
 * (shown at checkout); exposes only names, delivery days and the price.
 */

export interface ShippingQuote {
  methodId: string;
  name: string;
  description: string | null;
  minDays: number | null;
  maxDays: number | null;
  cost: Rial;
}

export async function shippingQuotes(locale: "fa" | "en", provinceCode: string, weightGrams: number, goodsSubtotal: Rial): Promise<ShippingQuote[]> {
  if (!isProvinceCode(provinceCode)) return [];
  const methods = await methodsForProvince(db(), provinceCode);
  const quotes: ShippingQuote[] = [];
  for (const m of methods) {
    // The first rate (lowest weight band) that covers the parcel.
    const rate = m.rates.find((r) => rateCovers(r, weightGrams));
    if (!rate) continue;
    const text = m.translations.find((t) => t.locale === locale) ?? m.translations.find((t) => t.locale === "fa") ?? m.translations[0];
    quotes.push({
      methodId: m.id,
      name: text?.name ?? "",
      description: text?.description ?? null,
      minDays: m.minDeliveryDays,
      maxDays: m.maxDeliveryDays,
      cost: shippingCost(rate, weightGrams, goodsSubtotal),
    });
  }
  return quotes;
}

/** The price of one method for this parcel, or null if it can't deliver there. */
export async function shippingQuoteFor(methodId: string, provinceCode: string, weightGrams: number, goodsSubtotal: Rial): Promise<{ methodId: string; cost: Rial } | null> {
  const quote = (await shippingQuotes("fa", provinceCode, weightGrams, goodsSubtotal)).find((q) => q.methodId === methodId);
  return quote ? { methodId: quote.methodId, cost: quote.cost } : null;
}
