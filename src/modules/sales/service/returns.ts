import "server-only";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import { cleanText } from "@/lib/i18n/names";
import { MoneyError, parseMoneyInput, subtract } from "@/lib/money";
import { toEnDigits } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import type { CurrentCustomer } from "@/modules/identity/service/current-customer";
import { releaseOrderHolds, restockLocations, restockReturn } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, authorizeAny, AuthzError } from "@/modules/rbac/service/authorize";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import {
  REFUND_METHODS,
  REFUNDABLE_ORDER_STATUSES,
  RETURN_REASONS,
  returnableQuantities,
  returnValue,
  withinReturnWindow,
} from "../domain/returns";
import { adminOrder, customerOrder, insertOutboxEvent, setActingUser, setOrderStatus } from "../repo/order-repo";
import {
  deliveredAt,
  hasOpenReturn,
  insertCompletedRefund,
  insertReturn,
  listReturns,
  lockOrderForReturn,
  lockReturn,
  markReturnReceived,
  orderTotal,
  receivedQuantities,
  refundByKey,
  refundedTotal,
  refundsOfOrder,
  returnByNumber,
  returnedQuantities,
  returnsOfOrder,
  setReturnDecision,
  setReturnStatus,
} from "../repo/return-repo";

/**
 * Returns and refunds (Phase 7).
 *
 *   customer asks (delivered order, within 7 days) -> requested
 *   requested --approve--> approved --receive--> received --refund--> completed
 *   requested --reject--> rejected       received --close (no refund)--> completed
 *
 * The order follows: delivered -> return_requested while a request is open,
 * back to delivered when it is rejected or only part of the order came back,
 * returned when every unit came back, and refunded once refunds reach its
 * total. Returns are handled with `return.manage`; refunds need
 * `refund.create` with a fresh two-factor check (Super and Business Admin).
 * A refund is recorded after the money was paid back by bank transfer or in
 * cash (no payment gateway can refund yet). Received goods marked sellable
 * go back on a shelf as 'return' stock movements. Everything is audited and
 * refunds are written to the outbox for accounting.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,18}$/;

export type ReturnResult =
  | { status: "ok"; returnNumber?: string }
  | { status: "not_found" }
  | { status: "invalid"; field: string }
  | { status: "wrong_status" }
  | { status: "too_much" };

class Stop extends Error {
  constructor(readonly result: ReturnResult) {
    super(result.status);
  }
}

const note = cleanText(1000, "invalid_text").transform((v) => v || null);
const quantity = z
  .string()
  .transform((v) => toEnDigits(v).trim())
  .pipe(z.string().regex(/^\d{0,4}$/, "invalid_quantity"))
  .transform((v) => (v === "" ? 0 : Number(v)));

function adminId(actor: Actor, permission: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(permission, "not_admin");
  return actor.userId;
}

const isRefundableStatus = (status: string) => (REFUNDABLE_ORDER_STATUSES as readonly string[]).includes(status);

function tooMuch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("cannot return") || message.includes("would exceed the order total");
}

// Customer -----------------------------------------------------------------------

/**
 * The return section of one of the customer's own orders: earlier returns,
 * and the lines they can still send back (empty when they can't ask now).
 */
export async function myOrderReturns(customer: CurrentCustomer, orderNumber: string, now = new Date()) {
  if (!NUMBER.test(orderNumber)) return null;
  const order = await customerOrder(db(), customer.userId, BigInt(orderNumber));
  if (!order) return null;
  const [returns, refunds] = await Promise.all([returnsOfOrder(db(), order.id), refundsOfOrder(db(), order.id)]);
  let returnable: { orderItemId: string; max: number }[] = [];
  let closedReason: "window" | "open" | null = null;
  if (order.status === "delivered") {
    const delivered = await deliveredAt(db(), order.id);
    if (!delivered || !withinReturnWindow(delivered, now)) closedReason = "window";
    else if (await hasOpenReturn(db(), order.id)) closedReason = "open";
    else {
      const left = returnableQuantities(order.items, await returnedQuantities(db(), order.id));
      returnable = order.items.map((i) => ({ orderItemId: i.id, max: left.get(i.id) ?? 0 })).filter((i) => i.max > 0);
    }
  }
  return {
    returns,
    refunds: refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status, method: r.method, createdAt: r.createdAt })),
    returnable,
    closedReason,
  };
}

/** The customer asks to send back some units of a delivered order. */
export async function requestReturn(
  customer: CurrentCustomer,
  orderNumber: string,
  input: { reason: string; note: string; quantities: Record<string, string> },
  now = new Date(),
): Promise<ReturnResult> {
  if (!NUMBER.test(orderNumber)) return { status: "not_found" };
  const order = await customerOrder(db(), customer.userId, BigInt(orderNumber));
  if (!order) return { status: "not_found" };
  const reason = RETURN_REASONS.find((r) => r === input.reason);
  if (!reason) return { status: "invalid", field: "reason_required" };
  const parsedNote = note.safeParse(input.note);
  if (!parsedNote.success) return { status: "invalid", field: "invalid_text" };
  const items: { orderItemId: string; quantity: number }[] = [];
  for (const item of order.items) {
    const q = quantity.safeParse(input.quantities[item.id] ?? "");
    if (!q.success) return { status: "invalid", field: "invalid_quantity" };
    if (q.data > 0) items.push({ orderItemId: item.id, quantity: q.data });
  }
  if (items.length === 0) return { status: "invalid", field: "nothing_selected" };
  try {
    const created = await transaction(async (tx) => {
      const locked = await lockOrderForReturn(tx, order.id);
      if (!locked || locked.userId !== customer.userId || locked.status !== "delivered") throw new Stop({ status: "wrong_status" });
      const delivered = await deliveredAt(tx, order.id);
      if (!delivered || !withinReturnWindow(delivered, now)) throw new Stop({ status: "invalid", field: "window_closed" });
      if (await hasOpenReturn(tx, order.id)) throw new Stop({ status: "wrong_status" });
      const left = returnableQuantities(locked.items, await returnedQuantities(tx, order.id));
      if (items.some((i) => i.quantity > (left.get(i.orderItemId) ?? 0))) throw new Stop({ status: "too_much" });
      const ret = await insertReturn(tx, { orderId: order.id, reason, customerNote: parsedNote.data, requestedById: customer.userId, items });
      await setActingUser(tx, customer.userId);
      await setOrderStatus(tx, order.id, "return_requested", `return ${ret.returnNumber}`);
      await insertOutboxEvent(tx, {
        topic: "return.requested",
        aggregateType: "order_return",
        aggregateId: ret.id,
        payload: { orderNumber: locked.orderNumber.toString(), returnNumber: ret.returnNumber.toString() },
        dedupeKey: `return.requested:${ret.id}`,
      });
      return ret;
    });
    return { status: "ok", returnNumber: created.returnNumber.toString() };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    if (tooMuch(error)) return { status: "too_much" };
    throw error;
  }
}

// Admin: returns -------------------------------------------------------------------

const RETURN_STATUSES = ["requested", "approved", "rejected", "received", "completed", "cancelled"] as const;

export async function returnsForAdmin(actor: Actor, status: string | null) {
  adminId(actor, "return.manage");
  await authorizeAny(actor, ["return.manage"], "order_returns");
  const filter = RETURN_STATUSES.find((s) => s === status) ?? null;
  return { rows: await listReturns(db(), filter, 100), status: filter };
}

/** A return with what the admin may do next, the shelves to restock onto and the suggested refund. */
export async function returnForAdmin(actor: Actor, returnNumber: string) {
  adminId(actor, "return.manage");
  await authorize(actor, "return.manage", undefined, { stepUp: false });
  if (!NUMBER.test(returnNumber)) return null;
  const ret = await returnByNumber(db(), BigInt(returnNumber));
  if (!ret) return null;
  const [locations, refunded] = await Promise.all([restockLocations(), refundedTotal(db(), ret.orderId)]);
  const value = returnValue(ret.items.map((i) => ({ lineTotal: i.orderItem.lineTotal, ordered: i.orderItem.quantity, returned: i.quantity })));
  const remaining = subtract(ret.order.grandTotal, refunded);
  const mayRefund = actor.permissions.has("refund.create");
  return {
    ret,
    locations,
    suggestedRefund: value < remaining ? value : remaining,
    remaining,
    can: {
      decide: ret.status === "requested",
      receive: ret.status === "approved",
      refund: ret.status === "received" && mayRefund && remaining > 0n,
      close: ret.status === "received",
    },
  };
}

/** Approve, reject (requested) or close without a refund (received). */
export async function decideReturn(actor: Actor, returnNumber: string, decision: "approve" | "reject" | "close", noteInput: string, now = new Date()): Promise<ReturnResult> {
  const userId = adminId(actor, "return.manage");
  await authorize(actor, "return.manage");
  if (!NUMBER.test(returnNumber)) return { status: "not_found" };
  const ret = await returnByNumber(db(), BigInt(returnNumber));
  if (!ret) return { status: "not_found" };
  const parsedNote = note.safeParse(noteInput);
  if (!parsedNote.success) return { status: "invalid", field: "invalid_text" };
  if (decision === "reject" && !parsedNote.data) return { status: "invalid", field: "note_required" };
  try {
    await transaction(async (tx) => {
      const order = await lockOrderForReturn(tx, ret.orderId);
      const locked = await lockReturn(tx, ret.id);
      const from = decision === "close" ? "received" : "requested";
      if (!order || locked?.status !== from) throw new Stop({ status: "wrong_status" });
      await setActingUser(tx, userId);
      if (decision === "close") await setReturnStatus(tx, ret.id, "completed");
      else await setReturnDecision(tx, ret.id, { status: decision === "approve" ? "approved" : "rejected", decidedById: userId, adminNote: parsedNote.data, at: now });
      // A rejected request gives the order back its delivered status.
      if (decision === "reject" && order.status === "return_requested") await setOrderStatus(tx, order.id, "delivered", `return ${ret.returnNumber} rejected`);
      const action = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "closed";
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: `return.${action}`, entityType: "order_return", entityId: ret.id, before: { status: from }, after: { status: decision === "close" ? "completed" : `${decision === "approve" ? "approved" : "rejected"}`, note: parsedNote.data } });
      if (decision !== "close") {
        await insertOutboxEvent(tx, {
          topic: `return.${action}`,
          aggregateType: "order_return",
          aggregateId: ret.id,
          payload: { orderNumber: order.orderNumber.toString(), returnNumber: ret.returnNumber.toString() },
          dedupeKey: `return.${action}:${ret.id}`,
        });
      }
    });
    return { status: "ok" };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    throw error;
  }
}

/**
 * The goods arrived: each line is marked sellable (back on the chosen shelf
 * as a 'return' movement) or not. The order becomes returned when every unit
 * of it has come back, otherwise delivered again.
 */
export async function receiveReturn(
  actor: Actor,
  returnNumber: string,
  lines: readonly { itemId: string; restock: boolean; locationId: string; condition: string }[],
  now = new Date(),
): Promise<ReturnResult> {
  const userId = adminId(actor, "return.manage");
  await authorize(actor, "return.manage");
  if (!NUMBER.test(returnNumber)) return { status: "not_found" };
  const ret = await returnByNumber(db(), BigInt(returnNumber));
  if (!ret) return { status: "not_found" };
  const byItem = new Map(lines.map((l) => [l.itemId, l]));
  const decided: { id: string; restock: boolean; condition: string | null; variantId: string; quantity: number; locationId: string | null }[] = [];
  const condition = cleanText(200, "invalid_text").transform((v) => v || null);
  for (const item of ret.items) {
    const line = byItem.get(item.id);
    const restock = line?.restock === true;
    const c = condition.safeParse(line?.condition ?? "");
    if (!c.success) return { status: "invalid", field: "invalid_text" };
    if (restock && !UUID.test(line?.locationId ?? "")) return { status: "invalid", field: "invalid_location" };
    decided.push({ id: item.id, restock, condition: c.data, variantId: item.orderItem.variantId, quantity: item.quantity, locationId: restock ? line!.locationId : null });
  }
  try {
    await transaction(async (tx) => {
      const order = await lockOrderForReturn(tx, ret.orderId);
      const locked = await lockReturn(tx, ret.id);
      if (!order || locked?.status !== "approved") throw new Stop({ status: "wrong_status" });
      await setActingUser(tx, userId);
      const restocked = decided.filter((d) => d.restock).map((d) => ({ variantId: d.variantId, locationId: d.locationId!, quantity: d.quantity }));
      if (!(await restockReturn(tx, { returnId: ret.id, returnNumber: ret.returnNumber.toString(), actorUserId: userId, lines: restocked }))) {
        throw new Stop({ status: "invalid", field: "invalid_location" });
      }
      await markReturnReceived(tx, ret.id, now, decided);
      const back = returnableQuantities(order.items, await receivedQuantities(tx, order.id));
      const all = [...back.values()].every((left) => left === 0);
      if (order.status === "return_requested") await setOrderStatus(tx, order.id, all ? "returned" : "delivered", `return ${ret.returnNumber} received`);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "return.received",
        entityType: "order_return",
        entityId: ret.id,
        before: { status: "approved" },
        after: { status: "received", items: decided.map((d) => ({ itemId: d.id, quantity: d.quantity, restock: d.restock, locationId: d.locationId, condition: d.condition })) },
      });
    });
    return { status: "ok" };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    throw error;
  }
}

// Admin: refunds ---------------------------------------------------------------------

export type RefundResult = { status: "ok"; refundId: string } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "wrong_status" } | { status: "too_much" };

/** Refunds and returns of an order for its admin screen, and whether this admin may refund now. */
export async function orderRefundsForAdmin(actor: Actor, orderId: string) {
  adminId(actor, "order.view");
  const mayRefund = actor.permissions.has("refund.create");
  const mayReturn = actor.permissions.has("return.manage");
  if (!mayRefund && !mayReturn) return null;
  const [order, refunds, returns, refunded] = await Promise.all([
    orderTotal(db(), orderId),
    refundsOfOrder(db(), orderId),
    returnsOfOrder(db(), orderId),
    refundedTotal(db(), orderId),
  ]);
  if (!order) return null;
  const remaining = subtract(order.grandTotal, refunded);
  return { refunds, returns, remaining, canRefund: mayRefund && isRefundableStatus(order.status) && remaining > 0n };
}

/**
 * Records money paid back to the customer (bank transfer or cash) and closes
 * the return it settles. When refunds reach the order's total the order
 * becomes refunded, and stock still held for an unsent order is released.
 * The idempotency key comes from the form, so pressing twice records once.
 */
export async function refundOrder(
  actor: Actor,
  orderNumber: string,
  input: { amount: string; method: string; reason: string; returnNumber: string; idempotencyKey: string },
  now = new Date(),
): Promise<RefundResult> {
  const userId = adminId(actor, "refund.create");
  await authorize(actor, "refund.create");
  if (!NUMBER.test(orderNumber)) return { status: "not_found" };
  if (!UUID.test(input.idempotencyKey)) return { status: "invalid", field: "invalid" };
  const earlier = await refundByKey(db(), input.idempotencyKey);
  if (earlier) return { status: "ok", refundId: earlier.id };
  const order = await adminOrder(db(), BigInt(orderNumber));
  if (!order) return { status: "not_found" };
  const method = REFUND_METHODS.find((m) => m === input.method);
  if (!method) return { status: "invalid", field: "invalid_method" };
  let amount: bigint;
  try {
    amount = parseMoneyInput(input.amount, await getDisplayUnit());
  } catch (error) {
    if (error instanceof MoneyError) return { status: "invalid", field: "invalid_amount" };
    throw error;
  }
  if (amount <= 0n) return { status: "invalid", field: "invalid_amount" };
  const reason = cleanText(500, "reason_required").safeParse(input.reason);
  if (!reason.success || reason.data.length < 3) return { status: "invalid", field: "reason_required" };
  let ret: Awaited<ReturnType<typeof returnByNumber>> = null;
  if (input.returnNumber) {
    ret = NUMBER.test(input.returnNumber) ? await returnByNumber(db(), BigInt(input.returnNumber)) : null;
    if (!ret || ret.orderId !== order.id) return { status: "not_found" };
  }
  try {
    const refundId = await transaction(async (tx) => {
      const locked = await lockOrderForReturn(tx, order.id);
      // Sent twice at once: the second waited for the order lock behind the first.
      const same = await refundByKey(tx, input.idempotencyKey);
      if (same) return same.id;
      if (!locked || !isRefundableStatus(locked.status)) throw new Stop({ status: "wrong_status" });
      if (ret && (await lockReturn(tx, ret.id))?.status !== "received") throw new Stop({ status: "wrong_status" });
      await setActingUser(tx, userId);
      const id = await insertCompletedRefund(tx, { orderId: order.id, returnId: ret?.id ?? null, amount, method, reason: reason.data, idempotencyKey: input.idempotencyKey, createdById: userId, at: now });
      if (ret) await setReturnStatus(tx, ret.id, "completed");
      const refunded = await refundedTotal(tx, order.id);
      if (refunded >= locked.grandTotal) {
        // Nothing left to send: stock still held for the order goes back on sale.
        if (locked.status === "paid" || locked.status === "processing") await releaseOrderHolds(tx, order.id, "released");
        await setOrderStatus(tx, order.id, "refunded", reason.data);
      }
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "refund.recorded",
        entityType: "order_refund",
        entityId: id,
        after: { orderId: order.id, returnId: ret?.id ?? null, amount: amount.toString(), method, reason: reason.data, orderStatus: refunded >= locked.grandTotal ? "refunded" : locked.status },
      });
      await insertOutboxEvent(tx, {
        topic: "refund.completed",
        aggregateType: "order_refund",
        aggregateId: id,
        payload: { orderId: order.id, orderNumber: locked.orderNumber.toString(), amount: amount.toString(), currency: "IRR", method },
        dedupeKey: `refund.completed:${id}`,
      });
      return id;
    });
    return { status: "ok", refundId };
  } catch (error) {
    if (error instanceof Stop) return error.result as RefundResult;
    if (tooMuch(error)) return { status: "too_much" };
    // The same form sent twice at once: the second insert hits the unique key.
    const again = await refundByKey(db(), input.idempotencyKey);
    if (again) return { status: "ok", refundId: again.id };
    throw error;
  }
}
