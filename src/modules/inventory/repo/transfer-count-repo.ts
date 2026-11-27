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

/** Ids of the transfer's lines whose products are in the categories (null = all). */
export async function transferLineIdsInScope(client: DbClient, transferId: string, categoryIds: readonly string[] | null): Promise<Set<string>> {
  const rows = await client.stockTransferLine.findMany({ where: { transferId, variant: { product: productsInCategories(categoryIds) } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export const TRANSFER_LINE_LIMIT = 500;

/**
 * Adds a line, or replaces the quantity when the product is already on the
 * transfer from that location. "full" when a new line would pass
 * TRANSFER_LINE_LIMIT.
 */
export async function upsertTransferLine(tx: Tx, line: { transferId: string; variantId: string; fromLocationId: string; toLocationId: string; quantity: number }): Promise<string | "full"> {
  const key = { transferId: line.transferId, variantId: line.variantId, fromLocationId: line.fromLocationId };
  const exists = await tx.stockTransferLine.findUnique({ where: { transferId_variantId_fromLocationId: key }, select: { id: true } });
  if (!exists && (await tx.stockTransferLine.count({ where: { transferId: line.transferId } })) >= TRANSFER_LINE_LIMIT) return "full";
  const row = await tx.stockTransferLine.upsert({
    where: { transferId_variantId_fromLocationId: { transferId: line.transferId, variantId: line.variantId, fromLocationId: line.fromLocationId } },
    create: line,
    update: { quantity: line.quantity, toLocationId: line.toLocationId },
    select: { id: true },
  });
  return row.id;
}

/** Deletes a line of the transfer; returns what it held, null when the transfer has no such line. */
export async function deleteTransferLine(tx: Tx, transferId: string, lineId: string) {
  const line = await tx.stockTransferLine.findFirst({
    where: { id: lineId, transferId },
    select: { id: true, variantId: true, fromLocationId: true, toLocationId: true, quantity: true, variant: { select: { sku: true } } },
  });
  if (!line) return null;
  await tx.stockTransferLine.delete({ where: { id: line.id } });
  return { lineId: line.id, variantId: line.variantId, sku: line.variant.sku, fromLocationId: line.fromLocationId, toLocationId: line.toLocationId, quantity: line.quantity };
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

/** How many product-and-location rows hold stock in the warehouse (or one of its locations). */
export async function stockedRows(client: DbClient, warehouseId: string, locationId: string | null): Promise<number> {
  return client.inventoryBalance.count({ where: { warehouseId, onHand: { gt: 0 }, ...(locationId ? { locationId } : {}) } });
}

/**
 * Starts a count: one line per product and location holding stock in the
 * warehouse, expecting what the system shows now (updated when each line
 * is counted). The service refuses a count that would pass
 * COUNT_LINE_LIMIT, so the LIMIT here is only a backstop. Returns the count
 * id and how many lines it has.
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
      startedById: true,
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
    client.inventoryCountLine.count({ where: { countId, countedQty: { not: null }, variant: { product: productsInCategories(categoryIds) } } }),
  ]);
  return { rows, total, counted };
}

export type CountEntryChange = { lineId: string; sku: string; before: { counted: number | null; expected: number }; after: { counted: number; expected: number } };

/**
 * Records a counted quantity on a line of an open count, for a product in
 * the category scope. The expected quantity becomes what the system shows
 * at this moment, so sales and receipts between the start of the count and
 * this line's count are not counted twice.
 *
 * A line already holding this counted quantity is left as it is: saving a
 * page again must not move its expected quantity to today's stock, or the
 * difference found earlier would be lost. Returns the change, "unchanged",
 * or null when the count has no such line in scope.
 */
export async function setCountedQty(tx: Tx, countId: string, lineId: string, categoryIds: readonly string[] | null, counted: number, at: Date): Promise<CountEntryChange | "unchanged" | null> {
  const line = await tx.inventoryCountLine.findFirst({
    where: { id: lineId, countId, variant: { product: productsInCategories(categoryIds) } },
    select: { variantId: true, locationId: true, countedQty: true, expectedQty: true, variant: { select: { sku: true } } },
  });
  if (!line) return null;
  if (line.countedQty === counted) return "unchanged";
  const balance = await tx.inventoryBalance.findUnique({ where: { variantId_locationId: { variantId: line.variantId, locationId: line.locationId } }, select: { onHand: true } });
  const expected = balance?.onHand ?? 0;
  await tx.inventoryCountLine.update({ where: { id: lineId }, data: { countedQty: counted, countedAt: at, expectedQty: expected } });
  return { lineId, sku: line.variant.sku, before: { counted: line.countedQty, expected: line.expectedQty }, after: { counted, expected } };
}

/** Adds a product found at a location that the count doesn't list yet (expected: what the system shows now). */
export async function addCountLine(tx: Tx, countId: string, variantId: string, locationId: string): Promise<"added" | "exists" | "full"> {
  if ((await tx.inventoryCountLine.count({ where: { countId } })) >= COUNT_LINE_LIMIT) return "full";
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
    // Always lock balances in the same order (location, then product), so two
    // stock changes never wait for each other in a circle.
    orderBy: [{ locationId: "asc" }, { variantId: "asc" }],
    select: { id: true, variantId: true, locationId: true, expectedQty: true, countedQty: true, variant: { select: { sku: true } } },
  });
}

export async function countedLineCount(client: DbClient, countId: string): Promise<number> {
  return client.inventoryCountLine.count({ where: { countId, countedQty: { not: null } } });
}

export async function linkCountMovement(tx: Tx, lineId: string, movementId: string): Promise<void> {
  await tx.inventoryCountLine.update({ where: { id: lineId }, data: { movementId } });
}

export async function finishCount(tx: Tx, id: string, status: "completed" | "cancelled", userId: string, at: Date): Promise<void> {
  await tx.inventoryCount.update({ where: { id }, data: status === "completed" ? { status, completedById: userId, completedAt: at } : { status } });
}
