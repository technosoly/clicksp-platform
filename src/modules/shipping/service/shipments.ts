import "server-only";
import { db } from "@/lib/db";
import { deliverShipments, insertShipment, orderShipments } from "../repo/shipment-repo";

/**
 * Shipments, written by the sales module inside its own fulfilment
 * transaction (sales authorizes the actor). Tracking codes are typed by staff
 * until a carrier adapter exists.
 */

type Tx = Parameters<typeof insertShipment>[0];

export async function recordShipments(
  tx: Tx,
  input: { orderId: string; methodId: string; trackingCode: string | null; at: Date; byWarehouse: Map<string, { orderItemId: string; quantity: number }[]> },
): Promise<string[]> {
  const ids: string[] = [];
  for (const [warehouseId, items] of [...input.byWarehouse.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    ids.push(await insertShipment(tx, { orderId: input.orderId, methodId: input.methodId, warehouseId, trackingCode: input.trackingCode, shippedAt: input.at, items }));
  }
  return ids;
}

export async function markShipmentsDelivered(tx: Tx, orderId: string, at: Date): Promise<void> {
  await deliverShipments(tx, orderId, at);
}

/**
 * An order's shipments. No actor here: only the sales module calls it, after
 * authorizing the order (orderForAdmin, or the customer's own order).
 */
export async function shipmentsOfOrder(orderId: string) {
  return orderShipments(db(), orderId);
}
