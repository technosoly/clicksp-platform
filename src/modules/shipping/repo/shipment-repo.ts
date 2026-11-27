/**
 * Shipments of orders: one per warehouse the parts leave from, with the
 * order lines it carries and an append-only tracking history.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

export async function insertShipment(
  tx: Tx,
  shipment: { orderId: string; methodId: string; warehouseId: string; trackingCode: string | null; shippedAt: Date; items: { orderItemId: string; quantity: number }[] },
): Promise<string> {
  const { items, ...row } = shipment;
  const created = await tx.shipment.create({
    data: {
      ...row,
      status: "picked_up",
      items: { create: items },
      trackingEvents: { create: { status: "picked_up", source: "manual", occurredAt: row.shippedAt } },
    },
    select: { id: true },
  });
  return created.id;
}

export async function deliverShipments(tx: Tx, orderId: string, at: Date): Promise<void> {
  const open = await tx.shipment.findMany({ where: { orderId, status: { notIn: ["delivered", "cancelled", "returned"] } }, select: { id: true } });
  for (const s of open) {
    await tx.shipment.update({ where: { id: s.id }, data: { status: "delivered", deliveredAt: at } });
    await tx.shipmentTrackingEvent.create({ data: { shipmentId: s.id, status: "delivered", source: "manual", occurredAt: at } });
  }
}

export async function orderShipments(client: DbClient, orderId: string) {
  return client.shipment.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, trackingCode: true, shippedAt: true, deliveredAt: true, warehouse: { select: { code: true } } },
  });
}
