import "server-only";
import { db, transaction } from "@/lib/db";
import { multiply, type Rial } from "@/lib/money";
import type { ShopLocale } from "@/modules/catalog/service/storefront";
import type { CurrentCustomer } from "@/modules/identity/service/current-customer";
import { reserveForOrder } from "@/modules/inventory/service/stock";
import { provinceName } from "@/modules/shipping/service/provinces";
import { shippingQuoteFor, shippingQuotes, type ShippingQuote } from "@/modules/shipping/service/shipping-quote";
import { checkoutInputSchema, PAYMENT_WINDOW_HOURS, type CheckoutInput } from "../domain/checkout-input";
import { computeOrderTotals } from "../domain/totals";
import {
  customerOrder,
  customerOrders,
  insertOrder,
  insertOutboxEvent,
  lockCustomerCart,
  markCartConverted,
  saveDefaultAddress,
  savedAddresses,
  setActingUser,
} from "../repo/order-repo";
import { viewCart, type CartView } from "./cart";

/**
 * Checkout and the customer's own orders. Only a signed-in customer (a
 * verified mobile number, resolved from the session by the caller) can
 * order, and every read is limited to that customer's own rows. Prices,
 * shipping and totals are computed here from the database; nothing the
 * browser sends is trusted except the address, the chosen method and a note.
 */

/** Weight of the cart's lines that can be ordered (parts without a weight count as 0 g). */
function cartWeight(cart: CartView): number {
  return cart.lines.reduce((sum, l) => sum + (l.item?.weightGrams ?? 0) * l.quantity, 0);
}

export async function checkoutPage(customer: CurrentCustomer, locale: ShopLocale) {
  const [cart, addresses] = await Promise.all([viewCart({ userId: customer.userId }, locale), savedAddresses(db(), customer.userId)]);
  return { cart, addresses, weightGrams: cartWeight(cart) };
}

/** Delivery options for the cart to a province (shown when the customer picks one). */
export async function checkoutShipping(customer: CurrentCustomer, locale: ShopLocale, provinceCode: string): Promise<ShippingQuote[]> {
  const cart = await viewCart({ userId: customer.userId }, locale);
  if (!cart.ready) return [];
  return shippingQuotes(locale, provinceCode, cartWeight(cart), cart.subtotal);
}

export type PlaceOrderResult =
  | { status: "ok"; orderNumber: bigint }
  | { status: "invalid"; field: string }
  | { status: "cart_empty" | "cart_changed" | "out_of_stock" | "shipping_unavailable" };

class OutOfStock extends Error {}
class CartChanged extends Error {}

export async function placeOrder(customer: CurrentCustomer, input: CheckoutInput, locale: ShopLocale, now = new Date()): Promise<PlaceOrderResult> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const data = parsed.data;

  // Price the cart as the customer saw it; the transaction below checks it is unchanged.
  const cart = await viewCart({ userId: customer.userId }, locale, now);
  if (cart.lines.length === 0) return { status: "cart_empty" };
  if (!cart.ready) return { status: "cart_changed" };
  const lines = cart.lines.map((l) => ({ ...l, item: l.item! }));
  const quote = await shippingQuoteFor(data.shippingMethodId, data.provinceCode, cartWeight(cart), cart.subtotal);
  if (!quote) return { status: "shipping_unavailable" };

  const totals = computeOrderTotals({
    lines: lines.map((l) => ({ unitPrice: l.item.price, quantity: l.quantity })),
    shipping: quote.cost,
    rounding: "half_up",
  });
  const address = {
    recipientName: data.recipientName,
    phone: data.phone,
    provinceCode: data.provinceCode,
    province: provinceName(data.provinceCode, "fa"),
    city: data.city,
    addressLine: data.addressLine,
    plaque: data.plaque,
    unit: data.unit,
    postalCode: data.postalCode,
  };

  try {
    const order = await transaction(async (tx) => {
      // The cart row lock serializes checkouts of the same cart: a double
      // submit finds the cart already converted.
      const locked = await lockCustomerCart(tx, customer.userId);
      if (!locked || locked.items.length === 0) throw new CartChanged();
      const same =
        locked.items.length === lines.length && locked.items.every((i, n) => i.variantId === lines[n]!.variantId && i.quantity === lines[n]!.quantity);
      if (!same) throw new CartChanged();

      await setActingUser(tx, customer.userId);
      const created = await insertOrder(tx, {
        userId: customer.userId,
        locale,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shipping,
        taxTotal: totals.tax,
        grandTotal: totals.total,
        shippingMethodId: quote.methodId,
        customerName: data.recipientName,
        customerPhone: customer.phone,
        customerNote: data.note,
        items: lines.map((l, i) => {
          const lineTotal: Rial = totals.lines[i]!.net;
          return {
            productId: l.item.productId,
            variantId: l.variantId,
            sku: l.item.sku,
            titleFa: l.item.titles.fa,
            titleEn: l.item.titles.en,
            snapshot: { slug: l.item.slug, weightGrams: l.item.weightGrams, compareAtPrice: l.item.compareAtPrice?.toString() ?? null },
            quantity: l.quantity,
            unitPrice: l.item.price,
            discountTotal: totals.lines[i]!.lineDiscount + totals.lines[i]!.allocatedOrderDiscount,
            lineTotal,
          };
        }),
        address,
      });
      const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_HOURS * 3_600_000);
      if (!(await reserveForOrder(tx, created.id, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), expiresAt))) throw new OutOfStock();
      await markCartConverted(tx, locked.id);
      if (data.saveAddress) await saveDefaultAddress(tx, customer.userId, address);
      await insertOutboxEvent(tx, {
        topic: "order.placed",
        aggregateType: "order",
        aggregateId: created.id,
        payload: { orderNumber: created.orderNumber.toString(), grandTotal: totals.total.toString() },
        dedupeKey: `order.placed:${created.id}`,
      });
      return created;
    });
    return { status: "ok", orderNumber: order.orderNumber };
  } catch (error) {
    if (error instanceof OutOfStock) return { status: "out_of_stock" };
    if (error instanceof CartChanged) return { status: "cart_changed" };
    throw error;
  }
}

// The customer's own orders ------------------------------------------------------

export async function myOrders(customer: CurrentCustomer) {
  return customerOrders(db(), customer.userId, 50);
}

/** One of the customer's orders by its number; null for anyone else's. */
export async function myOrder(customer: CurrentCustomer, orderNumber: string) {
  if (!/^\d{1,18}$/.test(orderNumber)) return null;
  return customerOrder(db(), customer.userId, BigInt(orderNumber));
}

/** Unit price × quantity, for display of a line (integer Rial). */
export const lineGross = (unitPrice: Rial, quantity: number): Rial => multiply(unitPrice, quantity);
