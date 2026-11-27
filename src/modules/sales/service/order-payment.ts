import "server-only";
import { db } from "@/lib/db";
import { hasPaymentInProgress, lockUnpaidOrder, markOrderPaid, orderNumberAndLocale, payableOrder, setActingUser, type Tx } from "../repo/order-repo";

/**
 * What the payments module needs from orders, inside its own transaction:
 * lock an order that awaits payment, and mark it paid once a payment for its
 * total has succeeded (the database checks that payment exists).
 */

export async function lockPayableOrder(tx: Tx, orderId: string) {
  if (!(await lockUnpaidOrder(tx, orderId))) return null;
  return payableOrder(tx, orderId);
}

/** True while one of the order's payments is being checked with the bank (holds expiry and cancelling). */
export async function paymentInProgress(tx: Tx, orderId: string): Promise<boolean> {
  return hasPaymentInProgress(tx, orderId);
}

export async function payOrder(tx: Tx, orderId: string, actingUserId: string | null, reason: string): Promise<void> {
  if (actingUserId) await setActingUser(tx, actingUserId);
  await markOrderPaid(tx, orderId, reason);
}

/** Number and language of an order, to send the customer back to it after paying. */
export async function orderReturnInfo(orderId: string) {
  return orderNumberAndLocale(db(), orderId);
}
