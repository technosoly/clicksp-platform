"use server";

import { refresh } from "next/cache";
import { isLocale } from "@/lib/i18n/config";
import { redirect } from "@/lib/i18n/navigation";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/money";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { checkoutShipping, placeOrder } from "../service/checkout";

export interface CheckoutState {
  /** Translation key under Checkout.errors. */
  error?: string;
}

export interface ShippingOption {
  methodId: string;
  name: string;
  description: string | null;
  minDays: number | null;
  maxDays: number | null;
  /** Formatted in the store's display unit (prices never travel as numbers to the browser). */
  cost: string;
  free: boolean;
}

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/** Delivery options for the signed-in customer's cart to a province. */
export async function shippingOptionsAction(locale: string, provinceCode: string): Promise<ShippingOption[]> {
  const customer = await currentCustomer();
  if (!customer || typeof provinceCode !== "string") return [];
  const shop = locale === "en" ? "en" : "fa";
  const [quotes, unit] = await Promise.all([checkoutShipping(customer, shop, provinceCode.slice(0, 8)), getDisplayUnit()]);
  return quotes.map((q) => ({ methodId: q.methodId, name: q.name, description: q.description, minDays: q.minDays, maxDays: q.maxDays, cost: formatMoney(q.cost, { locale: shop, unit }), free: q.cost === 0n }));
}

export async function placeOrderAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const raw = form.get("locale");
  const locale = isLocale(raw) ? raw : "fa";
  const customer = await currentCustomer();
  if (!customer) redirect({ href: "/login?next=/checkout", locale });
  let orderNumber: bigint;
  try {
    const result = await placeOrder(
      customer!,
      {
        recipientName: field(form, "recipientName"),
        phone: field(form, "phone"),
        provinceCode: field(form, "provinceCode"),
        city: field(form, "city"),
        addressLine: field(form, "addressLine"),
        plaque: field(form, "plaque"),
        unit: field(form, "unit"),
        postalCode: field(form, "postalCode"),
        shippingMethodId: field(form, "shippingMethodId"),
        note: field(form, "note"),
        saveAddress: form.get("saveAddress") === "on",
      },
      locale === "en" ? "en" : "fa",
    );
    if (result.status === "invalid") return { error: result.field };
    if (result.status !== "ok") return { error: result.status };
    orderNumber = result.orderNumber;
  } catch (error) {
    logger.error("Placing an order failed", { error: String(error) });
    return { error: "unexpected" };
  }
  // The cart is now empty: refresh the header's count along with the page.
  refresh();
  redirect({ href: `/account/orders/${orderNumber}`, locale });
  return {};
}
