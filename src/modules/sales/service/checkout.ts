import "server-only";
import { db, transaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import { multiply, type Rial } from "@/lib/money";
import { lockVariantPrices, type ShopLocale } from "@/modules/catalog/service/storefront";
import type { CurrentCustomer } from "@/modules/identity/service/current-customer";
import { releaseOrderHolds, reserveForOrder } from "@/modules/inventory/service/stock";
import { provinceName } from "@/modules/shipping/service/provinces";
import { shippingQuoteFor, shippingQuotes, type ShippingQuote } from "@/modules/shipping/service/shipping-quote";
import { checkoutInputSchema, MAX_OPEN_ORDERS, PAYMENT_WINDOW_HOURS, type CheckoutInput } from "../domain/checkout-input";
import { computeOrderTotals } from "../domain/totals";
import {
  cancelUnpaidOrder,
  customerOrder,
  customerOrders,
  expiredUnpaidOrders,
  insertOrder,
  insertOutboxEvent,
  lockCustomerCart,
  lockUnpaidOrder,
  markCartConverted,
  openOrderCount,
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

/**
 * Cancels unpaid orders whose stock hold ran out and gives the stock back.
 * Runs a few at a time on every checkout until the background jobs take it
 * over; safe to run concurrently (each order is locked and re-checked).
 */
export async function expireUnpaidOrders(now = new Date(), batch = 20): Promise<number> {
  let done = 0;
  try {
    for (const orderId of await expiredUnpaidOrders(db(), now, batch)) {
      try {
        const cancelled = await transaction(async (tx) => {
          if (!(await lockUnpaidOrder(tx, orderId))) return false;
          await releaseOrderHolds(tx, orderId, "expired");
          await cancelUnpaidOrder(tx, orderId, "payment_window_expired");
          await insertOutboxEvent(tx, { topic: "order.expired", aggregateType: "order", aggregateId: orderId, payload: { reason: "payment_window_expired" }, dedupeKey: `order.expired:${orderId}` });
          return true;
        });
        if (cancelled) done += 1;
      } catch (error) {
        // Housekeeping never blocks a checkout; the next run tries again.
        logger.error("Expiring an unpaid order failed", { orderId, error: String(error) });
      }
    }
  } catch (error) {
    logger.error("Finding expired unpaid orders failed", { error: String(error) });
  }
  return done;
}

export async function checkoutPage(customer: CurrentCustomer, locale: ShopLocale) {
  await expireUnpaidOrders();
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
  | { status: "cart_empty" | "cart_changed" | "out_of_stock" | "shipping_unavailable" | "too_many_open_orders" };

class OutOfStock extends Error {}
class CartChanged extends Error {}
class TooManyOpenOrders extends Error {}

export async function placeOrder(customer: CurrentCustomer, input: CheckoutInput, locale: ShopLocale, now = new Date()): Promise<PlaceOrderResult> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const data = parsed.data;

  await expireUnpaidOrders(now);
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
      // Prices and limits again, now with the variants share-locked: a price
      // change or unpublish that committed meanwhile sends the customer back.
      const current = await lockVariantPrices(tx, lines.map((l) => l.variantId));
      const unchanged = lines.every((l) => {
        const fresh = current.get(l.variantId);
        return fresh !== undefined && fresh.price === l.item.price && l.quantity >= fresh.minQty && (fresh.maxQty === null || l.quantity <= fresh.maxQty);
      });
      if (!unchanged) throw new CartChanged();
      const requote = await shippingQuoteFor(data.shippingMethodId, data.provinceCode, cartWeight(cart), cart.subtotal);
      if (!requote || requote.cost !== quote.cost) throw new CartChanged();
      // The cart lock serializes this customer's checkouts, so the count can't race.
      if ((await openOrderCount(tx, customer.userId)) >= MAX_OPEN_ORDERS) throw new TooManyOpenOrders();

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
    if (error instanceof TooManyOpenOrders) return { status: "too_many_open_orders" };
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
