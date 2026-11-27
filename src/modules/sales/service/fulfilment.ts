import "server-only";
import { db, transaction } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import { takeOrderStock } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { markShipmentsDelivered, recordShipments } from "@/modules/shipping/service/shipments";
import { adminOrder, insertOutboxEvent, lockOrderForFulfilment, setActingUser, setOrderStatus } from "../repo/order-repo";

/**
 * Packing and shipping paid orders (order.fulfil; Store Staff only for orders
 * whose stock is all in their warehouses). Each step locks the order, moves
 * it one step along the state machine the database enforces, and is audited:
 * - pack:    paid -> processing
 * - ship:    processing -> shipped. The held stock leaves the shelves as
 *            'sale' movements and a shipment per warehouse is recorded, with
 *            the carrier's tracking code when there is one.
 * - deliver: shipped -> delivered.
 * Shipping and delivery are written to the outbox for customer messages.
 */

export const FULFIL_STEPS = { pack: "paid", ship: "processing", deliver: "shipped" } as const;
export type FulfilStep = keyof typeof FULFIL_STEPS;
const NEXT = { pack: "processing", ship: "shipped", deliver: "delivered" } as const;

export type FulfilResult = { status: "ok" } | { status: "not_found" } | { status: "wrong_status" } | { status: "invalid"; field: string };

function adminId(actor: Actor): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("order.fulfil", "not_admin");
  return actor.userId;
}

/** Tracking codes as carriers print them: letters and digits, 4 to 40. */
function trackingCode(input: string): string | null | "invalid" {
  const code = normalizeIdentifier(input);
  if (code === "") return null;
  return /^[A-Z0-9]{4,40}$/.test(code) ? code : "invalid";
}

/** True when the actor may fulfil an order whose stock sits in these warehouses. */
export function canFulfil(actor: Actor, warehouseIds: readonly string[]): boolean {
  const grant = actor.permissions.get("order.fulfil");
  if (!grant) return false;
  return grant.unscoped || (warehouseIds.length > 0 && warehouseIds.every((w) => grant.warehouseIds.has(w)));
}

export async function fulfilOrder(actor: Actor, orderNumber: string, step: FulfilStep, input: { trackingCode?: string } = {}): Promise<FulfilResult> {
  const userId = adminId(actor);
  if (!(step in FULFIL_STEPS)) return { status: "invalid", field: "step" };
  if (!/^\d{1,18}$/.test(orderNumber)) return { status: "not_found" };
  const order = await adminOrder(db(), BigInt(orderNumber));
  const warehouseIds = order ? [...new Set(order.reservations.map((r) => r.balance.warehouseId))] : [];
  try {
    await authorize(actor, "order.fulfil", { type: "order", id: order?.id, warehouseIds });
  } catch (error) {
    // As on the order screen: an order outside the actor's warehouses doesn't exist for them.
    if (error instanceof AuthzError && actor.permissions.has("order.fulfil")) return { status: "not_found" };
    throw error;
  }
  if (!order) return { status: "not_found" };
  const code = step === "ship" ? trackingCode(input.trackingCode ?? "") : null;
  if (code === "invalid") return { status: "invalid", field: "invalid_tracking" };

  const done = await transaction(async (tx) => {
    const locked = await lockOrderForFulfilment(tx, order.id);
    if (!locked || locked.status !== FULFIL_STEPS[step]) return false;
    await setActingUser(tx, userId);
    const at = new Date();
    if (step === "ship") {
      const taken = await takeOrderStock(tx, order.id, userId, code);
      const itemOf = new Map(locked.items.map((i) => [i.variantId, i.id]));
      const byWarehouse = new Map<string, { orderItemId: string; quantity: number }[]>();
      for (const t of taken) {
        const orderItemId = itemOf.get(t.variantId);
        if (!orderItemId) continue;
        const list = byWarehouse.get(t.warehouseId) ?? [];
        const same = list.find((l) => l.orderItemId === orderItemId);
        if (same) same.quantity += t.quantity;
        else list.push({ orderItemId, quantity: t.quantity });
        byWarehouse.set(t.warehouseId, list);
      }
      if (locked.shippingMethodId && byWarehouse.size > 0) await recordShipments(tx, { orderId: order.id, methodId: locked.shippingMethodId, trackingCode: code, at, byWarehouse });
    }
    if (step === "deliver") await markShipmentsDelivered(tx, order.id, at);
    await setOrderStatus(tx, order.id, NEXT[step], null);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: `order.${NEXT[step]}`,
      entityType: "order",
      entityId: order.id,
      before: { status: FULFIL_STEPS[step] },
      after: { status: NEXT[step], ...(code ? { trackingCode: code } : {}) },
    });
    if (step !== "pack") {
      await insertOutboxEvent(tx, {
        topic: `order.${NEXT[step]}`,
        aggregateType: "order",
        aggregateId: order.id,
        payload: { orderNumber: locked.orderNumber.toString(), ...(code ? { trackingCode: code } : {}) },
        dedupeKey: `order.${NEXT[step]}:${order.id}`,
      });
    }
    return true;
  });
  return done ? { status: "ok" } : { status: "wrong_status" };
}
