/**
 * Database access for order returns and refunds. The database enforces the
 * money and quantity limits: a line is never returned more times than it
 * was ordered (order_return_items_guard), refunds never add up to more than
 * the order's total (order_refunds_guard, which locks the order), refunds
 * are never deleted, and the order moves only along its state machine.
 */
import type { Prisma, ReturnReason, ReturnStatus } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import { OPEN_RETURN_STATUSES } from "../domain/returns";

type Tx = Prisma.TransactionClient;

/** Locks the order row and returns what a return or refund needs from it. */
export async function lockOrderForReturn(tx: Tx, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, grandTotal: true, userId: true, items: { select: { id: true, variantId: true, quantity: true, lineTotal: true } } },
  });
}

export async function orderTotal(client: DbClient, orderId: string) {
  return client.order.findUnique({ where: { id: orderId }, select: { status: true, grandTotal: true } });
}

/**
 * When the order was first delivered (null if never). The order also goes
 * back to delivered after a rejected or partial return; that must not
 * restart the return window.
 */
export async function deliveredAt(client: DbClient, orderId: string): Promise<Date | null> {
  const row = await client.orderStatusHistory.findFirst({ where: { orderId, fromStatus: "shipped", toStatus: "delivered" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return row?.createdAt ?? null;
}

/** Quantities already covered by the order's returns that were not rejected or cancelled. */
export async function returnedQuantities(client: DbClient, orderId: string) {
  return client.orderReturnItem.findMany({
    where: { orderReturn: { orderId, status: { notIn: ["rejected", "cancelled"] } } },
    select: { orderItemId: true, quantity: true },
  });
}

export async function hasOpenReturn(client: DbClient, orderId: string): Promise<boolean> {
  return (await client.orderReturn.count({ where: { orderId, status: { in: [...OPEN_RETURN_STATUSES] } } })) > 0;
}

export async function insertReturn(
  tx: Tx,
  row: { orderId: string; reason: ReturnReason; customerNote: string | null; requestedById: string; items: readonly { orderItemId: string; quantity: number }[] },
): Promise<{ id: string; returnNumber: bigint }> {
  return tx.orderReturn.create({
    data: {
      orderId: row.orderId,
      reason: row.reason,
      customerNote: row.customerNote,
      requestedById: row.requestedById,
      items: { create: row.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
    },
    select: { id: true, returnNumber: true },
  });
}

const returnSelect = {
  id: true,
  returnNumber: true,
  status: true,
  reason: true,
  customerNote: true,
  adminNote: true,
  createdAt: true,
  decidedAt: true,
  receivedAt: true,
  decidedBy: { select: { name: true } },
  items: {
    orderBy: { id: "asc" },
    select: { id: true, quantity: true, restock: true, condition: true, orderItem: { select: { id: true, variantId: true, sku: true, titleFa: true, titleEn: true, quantity: true, lineTotal: true } } },
  },
  refunds: { orderBy: { createdAt: "asc" }, select: { id: true, amount: true, status: true, method: true, createdAt: true } },
} satisfies Prisma.OrderReturnSelect;

export async function returnsOfOrder(client: DbClient, orderId: string) {
  return client.orderReturn.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, select: returnSelect });
}

export async function returnByNumber(client: DbClient, returnNumber: bigint) {
  return client.orderReturn.findUnique({
    where: { returnNumber },
    select: { ...returnSelect, orderId: true, order: { select: { id: true, orderNumber: true, status: true, grandTotal: true, customerName: true, customerPhone: true } } },
  });
}

export async function listReturns(client: DbClient, status: ReturnStatus | null, take: number) {
  return client.orderReturn.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, returnNumber: true, status: true, reason: true, createdAt: true, order: { select: { orderNumber: true, customerName: true } }, _count: { select: { items: true } } },
  });
}

/** Locks a return for a status change. */
export async function lockReturn(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: ReturnStatus; order_id: string }[]>`SELECT status, order_id FROM order_returns WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function setReturnDecision(tx: Tx, id: string, data: { status: "approved" | "rejected"; decidedById: string; adminNote: string | null; at: Date }): Promise<void> {
  await tx.orderReturn.update({ where: { id }, data: { status: data.status, decidedById: data.decidedById, decidedAt: data.at, adminNote: data.adminNote ?? undefined } });
}

export async function markReturnReceived(tx: Tx, id: string, at: Date, items: readonly { id: string; restock: boolean; condition: string | null }[]): Promise<void> {
  for (const item of items) await tx.orderReturnItem.update({ where: { id: item.id }, data: { restock: item.restock, condition: item.condition } });
  await tx.orderReturn.update({ where: { id }, data: { status: "received", receivedAt: at } });
}

export async function setReturnStatus(tx: Tx, id: string, status: "completed" | "cancelled"): Promise<void> {
  await tx.orderReturn.update({ where: { id }, data: { status } });
}

/** Units of each order line that ended up returned (received or completed returns). */
export async function receivedQuantities(client: DbClient, orderId: string) {
  return client.orderReturnItem.findMany({ where: { orderReturn: { orderId, status: { in: ["received", "completed"] } } }, select: { orderItemId: true, quantity: true } });
}

// Refunds ------------------------------------------------------------------------

export async function refundByKey(client: DbClient, idempotencyKey: string) {
  return client.orderRefund.findUnique({ where: { idempotencyKey }, select: { id: true, orderId: true } });
}

/** Records a manual refund that has already been paid out (completed). */
export async function insertCompletedRefund(
  tx: Tx,
  row: { orderId: string; returnId: string | null; amount: bigint; method: "bank_transfer" | "cash"; reason: string; idempotencyKey: string; createdById: string; at: Date },
): Promise<string> {
  const refund = await tx.orderRefund.create({
    data: {
      orderId: row.orderId,
      returnId: row.returnId,
      amount: row.amount,
      method: row.method,
      reason: row.reason,
      idempotencyKey: row.idempotencyKey,
      createdById: row.createdById,
      status: "completed",
      processedAt: row.at,
    },
    select: { id: true },
  });
  return refund.id;
}

/** Money already given back on the order (refunds not failed or cancelled). */
export async function refundedTotal(client: DbClient, orderId: string): Promise<bigint> {
  const sum = await client.orderRefund.aggregate({ where: { orderId, status: { notIn: ["failed", "cancelled"] } }, _sum: { amount: true } });
  return sum._sum.amount ?? 0n;
}

export async function refundsOfOrder(client: DbClient, orderId: string) {
  return client.orderRefund.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true, status: true, method: true, reason: true, createdAt: true, returnId: true, createdBy: { select: { name: true } } },
  });
}

// For accounting ---------------------------------------------------------------------

export async function refundForPosting(client: DbClient, refundId: string) {
  return client.orderRefund.findUnique({
    where: { id: refundId },
    select: { id: true, amount: true, method: true, status: true, processedAt: true, createdAt: true, order: { select: { orderNumber: true } } },
  });
}
