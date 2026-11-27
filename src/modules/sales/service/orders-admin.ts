import "server-only";
import { db, transaction } from "@/lib/db";
import { normalizeForStorage } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import { releaseOrderHolds } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, authorizeAny, AuthzError } from "@/modules/rbac/service/authorize";
import { adminOrder, adminOrderList, cancelUnpaidOrder, insertOutboxEvent, lockUnpaidOrder, setActingUser } from "../repo/order-repo";

/**
 * Orders in the admin. Viewing needs `order.view`, which Store Staff hold
 * only for their warehouses: they see orders with stock held or taken there.
 * Cancelling needs `order.cancel` (Super and Business Admin) and is audited.
 */

export const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "return_requested", "returned", "refunded"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUSES)[number];

const LIST_SIZE = 100;

function adminId(actor: Actor, key: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(key, "not_admin");
  return actor.userId;
}

/** The warehouses `order.view` covers: null = all. */
function viewScope(actor: Actor): string[] | null {
  const grant = actor.permissions.get("order.view");
  return !grant || grant.unscoped ? null : [...grant.warehouseIds];
}

export async function ordersForAdmin(actor: Actor, status: string | null) {
  adminId(actor, "order.view");
  await authorizeAny(actor, ["order.view"], "orders");
  const filter = ORDER_STATUSES.find((s) => s === status) ?? null;
  const rows = await adminOrderList(db(), viewScope(actor), filter, LIST_SIZE);
  return { rows, status: filter, limited: rows.length === LIST_SIZE };
}

export async function orderForAdmin(actor: Actor, orderNumber: string) {
  adminId(actor, "order.view");
  if (!/^\d{1,18}$/.test(orderNumber)) return null;
  const order = await adminOrder(db(), BigInt(orderNumber));
  if (!order) {
    await authorizeAny(actor, ["order.view"], "orders");
    return null;
  }
  const warehouseIds = [...new Set(order.reservations.map((r) => r.balance.warehouseId))];
  try {
    await authorize(actor, "order.view", { type: "order", id: order.id, warehouseIds });
  } catch (error) {
    // Staff outside the order's warehouses get "not found", not "forbidden",
    // so order numbers don't reveal other warehouses' orders (the denial is
    // still recorded as a security event by authorize).
    if (error instanceof AuthzError && actor.permissions.has("order.view")) return null;
    throw error;
  }
  return { order, canCancel: actor.permissions.has("order.cancel") && order.status === "pending_payment" };
}

export type AdminOrderResult = { status: "ok" } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "not_cancellable" };

/** Cancels an order that awaits payment and gives its stock back. */
export async function cancelOrderByAdmin(actor: Actor, orderNumber: string, reasonInput: string): Promise<AdminOrderResult> {
  const userId = adminId(actor, "order.cancel");
  await authorize(actor, "order.cancel");
  const reason = normalizeForStorage(reasonInput).trim();
  if (reason.length < 3 || reason.length > 500) return { status: "invalid", field: "reason_required" };
  if (!/^\d{1,18}$/.test(orderNumber)) return { status: "not_found" };
  const order = await adminOrder(db(), BigInt(orderNumber));
  if (!order) return { status: "not_found" };
  const done = await transaction(async (tx) => {
    if (!(await lockUnpaidOrder(tx, order.id))) return false;
    await setActingUser(tx, userId);
    await releaseOrderHolds(tx, order.id, "released");
    await cancelUnpaidOrder(tx, order.id, reason);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "order.cancelled", entityType: "order", entityId: order.id, before: { status: order.status }, after: { status: "cancelled", reason } });
    await insertOutboxEvent(tx, { topic: "order.cancelled", aggregateType: "order", aggregateId: order.id, payload: { orderNumber: order.orderNumber.toString() }, dedupeKey: `order.cancelled:${order.id}` });
    return true;
  });
  return done ? { status: "ok" } : { status: "not_cancellable" };
}
