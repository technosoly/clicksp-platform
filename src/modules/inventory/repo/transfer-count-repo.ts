/**
 * Database access for stock transfers between warehouses and stock counts.
 * Stock itself changes only through inventory_movements (see
 * inventory-repo.ts): the database applies each movement to its balance and
 * refuses stock below zero or below what open orders reserve.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import { productsInCategories } from "./inventory-repo";

type Tx = Prisma.TransactionClient;

const productTitles = { select: { id: true, translations: { select: { locale: true, title: true } } } } as const;

// Transfers ---------------------------------------------------------------------

export async function insertTransfer(tx: Tx, row: { fromWarehouseId: string; toWarehouseId: string; note: string | null; createdById: string }): Promise<string> {
  return (await tx.stockTransfer.create({ data: row, select: { id: true } })).id;
}

/** Transfers from or to the given warehouses (null = all), newest first. */
export async function listTransfers(client: DbClient, warehouseIds: readonly string[] | null, take: number) {
  return client.stockTransfer.findMany({
    where: warehouseIds === null ? {} : { OR: [{ fromWarehouseId: { in: [...warehouseIds] } }, { toWarehouseId: { in: [...warehouseIds] } }] },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      status: true,
      createdAt: true,
      fromWarehouse: { select: { code: true, name: true } },
      toWarehouse: { select: { code: true, name: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getTransfer(client: DbClient, id: string) {
  return client.stockTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      note: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      createdAt: true,
      shippedAt: true,
      receivedAt: true,
      fromWarehouse: { select: { code: true, name: true } },
      toWarehouse: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: { id: true, quantity: true, fromLocationId: true, toLocationId: true, variant: { select: { id: true, sku: true, product: productTitles } } },
      },
    },
  });
}

/** Locks the transfer row for a status change; returns its status and warehouses. */
export async function lockTransfer(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: string; from_warehouse_id: string; to_warehouse_id: string }[]>`
    SELECT status::text, from_warehouse_id, to_warehouse_id FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function transferLines(tx: Tx, transferId: string) {
  return tx.stockTransferLine.findMany({ where: { transferId }, orderBy: { id: "asc" }, select: { id: true, variantId: true, fromLocationId: true, toLocationId: true, quantity: true } });
}

/** Adds a line, or replaces the quantity when the product is already on the transfer from that location. */
export async function upsertTransferLine(tx: Tx, line: { transferId: string; variantId: string; fromLocationId: string; toLocationId: string; quantity: number }): Promise<string> {
  const row = await tx.stockTransferLine.upsert({
    where: { transferId_variantId_fromLocationId: { transferId: line.transferId, variantId: line.variantId, fromLocationId: line.fromLocationId } },
    create: line,
    update: { quantity: line.quantity, toLocationId: line.toLocationId },
    select: { id: true },
  });
  return row.id;
}

export async function deleteTransferLine(tx: Tx, transferId: string, lineId: string): Promise<boolean> {
  return (await tx.stockTransferLine.deleteMany({ where: { id: lineId, transferId } })).count === 1;
}

export async function setTransferStatus(
  tx: Tx,
  id: string,
  status: "in_transit" | "received" | "cancelled",
  at: Date,
): Promise<void> {
  await tx.stockTransfer.update({
    where: { id },
    data: { status, ...(status === "in_transit" ? { shippedAt: at } : status === "received" ? { receivedAt: at } : {}) },
  });
}

// Counts ------------------------------------------------------------------------

export const COUNT_LINE_LIMIT = 5000;

/**
 * Starts a count: one line per product and location holding stock in the
 * warehouse, expecting what the system shows now (updated when each line
 * is counted). Returns the count id and how many lines it has.
 */
export async function insertCount(tx: Tx, row: { warehouseId: string; locationId: string | null; note: string | null; startedById: string }): Promise<{ id: string; lines: number }> {
  const count = await tx.inventoryCount.create({ data: { warehouseId: row.warehouseId, note: row.note, startedById: row.startedById }, select: { id: true } });
  const lines = await tx.$executeRaw`
    INSERT INTO inventory_count_lines (count_id, variant_id, location_id, expected_qty)
    SELECT ${count.id}::uuid, b.variant_id, b.location_id, b.on_hand
      FROM inventory_balances b JOIN warehouse_locations l ON l.id = b.location_id
     WHERE b.warehouse_id = ${row.warehouseId}::uuid AND b.on_hand > 0
       AND (${row.locationId}::uuid IS NULL OR b.location_id = ${row.locationId}::uuid)
     ORDER BY l.code, b.variant_id
     LIMIT ${COUNT_LINE_LIMIT}`;
  return { id: count.id, lines };
}

export async function listCounts(client: DbClient, warehouseIds: readonly string[] | null, take: number) {
  return client.inventoryCount.findMany({
    where: warehouseIds === null ? {} : { warehouseId: { in: [...warehouseIds] } },
    orderBy: { startedAt: "desc" },
    take,
    select: { id: true, status: true, startedAt: true, completedAt: true, warehouse: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
  });
}

export async function getCount(client: DbClient, id: string) {
  return client.inventoryCount.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      note: true,
      warehouseId: true,
      startedAt: true,
      completedAt: true,
      warehouse: { select: { code: true, name: true } },
      startedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
    },
  });
}

/** The count's lines for products in the category scope, a page at a time, uncounted first when asked. */
export async function countLines(client: DbClient, countId: string, categoryIds: readonly string[] | null, page: { skip: number; take: number; onlyUncounted: boolean }) {
  const where = {
    countId,
    ...(page.onlyUncounted ? { countedQty: null } : {}),
    variant: { product: productsInCategories(categoryIds) },
  };
  const [rows, total, counted] = await Promise.all([
    client.inventoryCountLine.findMany({
      where,
      orderBy: [{ locationId: "asc" }, { variant: { sku: "asc" } }],
      skip: page.skip,
      take: page.take,
      select: { id: true, locationId: true, expectedQty: true, countedQty: true, countedAt: true, movementId: true, variant: { select: { id: true, sku: true, product: productTitles } } },
    }),
    client.inventoryCountLine.count({ where }),
    client.inventoryCountLine.count({ where: { countId, countedQty: { not: null } } }),
  ]);
  return { rows, total, counted };
}

/**
 * Records a counted quantity on a line of an open count, for a product in
 * the category scope. The expected quantity becomes what the system shows
 * at this moment, so sales and receipts between the start of the count and
 * this line's count are not counted twice. false when no such line.
 */
export async function setCountedQty(tx: Tx, countId: string, lineId: string, categoryIds: readonly string[] | null, counted: number, at: Date): Promise<boolean> {
  const line = await tx.inventoryCountLine.findFirst({
    where: { id: lineId, countId, variant: { product: productsInCategories(categoryIds) } },
    select: { variantId: true, locationId: true },
  });
  if (!line) return false;
  const balance = await tx.inventoryBalance.findUnique({ where: { variantId_locationId: { variantId: line.variantId, locationId: line.locationId } }, select: { onHand: true } });
  await tx.inventoryCountLine.update({ where: { id: lineId }, data: { countedQty: counted, countedAt: at, expectedQty: balance?.onHand ?? 0 } });
  return true;
}

/** Adds a product found at a location that the count doesn't list yet (expected: what the system shows now). */
export async function addCountLine(tx: Tx, countId: string, variantId: string, locationId: string): Promise<"added" | "exists"> {
  const balance = await tx.inventoryBalance.findUnique({ where: { variantId_locationId: { variantId, locationId } }, select: { onHand: true } });
  const inserted = await tx.$executeRaw`
    INSERT INTO inventory_count_lines (count_id, variant_id, location_id, expected_qty)
    VALUES (${countId}::uuid, ${variantId}::uuid, ${locationId}::uuid, ${balance?.onHand ?? 0})
    ON CONFLICT (count_id, variant_id, location_id) DO NOTHING`;
  return inserted === 1 ? "added" : "exists";
}

/** Locks the count row for a status change. */
export async function lockCount(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: string; warehouse_id: string }[]>`SELECT status::text, warehouse_id FROM inventory_counts WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function countedLines(tx: Tx, countId: string) {
  return tx.inventoryCountLine.findMany({
    where: { countId, countedQty: { not: null }, movementId: null },
    orderBy: { id: "asc" },
    select: { id: true, variantId: true, locationId: true, expectedQty: true, countedQty: true, variant: { select: { sku: true } } },
  });
}

export async function linkCountMovement(tx: Tx, lineId: string, movementId: string): Promise<void> {
  await tx.inventoryCountLine.update({ where: { id: lineId }, data: { movementId } });
}

export async function finishCount(tx: Tx, id: string, status: "completed" | "cancelled", userId: string, at: Date): Promise<void> {
  await tx.inventoryCount.update({ where: { id }, data: status === "completed" ? { status, completedById: userId, completedAt: at } : { status } });
}
