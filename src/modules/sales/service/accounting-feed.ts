import "server-only";
import { db } from "@/lib/db";
import { orderForPosting } from "../repo/order-repo";
import { refundForPosting } from "../repo/return-repo";

/**
 * What the accounting module reads from orders to post them (called from its
 * outbox handlers, which run as the system, not as a person). Read-only.
 */

/** A paid order's totals and payment time; null when the order doesn't exist or was never paid. */
export async function paidOrderForAccounting(orderId: string) {
  return orderForPosting(db(), orderId);
}

/** A completed refund; null when it doesn't exist or isn't completed. */
export async function completedRefundForAccounting(refundId: string) {
  const refund = await refundForPosting(db(), refundId);
  return refund?.status === "completed" ? { id: refund.id, amount: refund.amount, method: refund.method, at: refund.processedAt ?? refund.createdAt, orderNumber: refund.order.orderNumber } : null;
}
