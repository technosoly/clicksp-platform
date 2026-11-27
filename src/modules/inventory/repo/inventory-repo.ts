/**
 * Database access for warehouses, storage locations, balances and movements.
 * Balances are never written here: the database derives them from
 * inventory_movements (and stock_reservations) under row locks, and its
 * CHECKs refuse stock below zero or below what is reserved.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { AdjustmentReason, MovementReferenceType, MovementType } from "@/generated/prisma/client";
import { DEFAULT_LOCATION_CODE, type LocationData, type WarehouseData } from "../domain/inventory-input";

type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `null` means every warehouse. */
const inWarehouses = (ids: readonly string[] | null) => (ids === null ? {} : { warehouseId: { in: [...ids] } });

// Warehouses and locations ---------------------------------------------------

export async function listWarehouses(client: DbClient, ids: readonly string[] | null) {
  return client.warehouse.findMany({
    where: ids === null ? {} : { id: { in: [...ids] } },
    orderBy: [{ isActive: "desc" }, { priority: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, city: true, priority: true, isActive: true, _count: { select: { locations: true } } },
  });
}

export async function getWarehouse(client: DbClient, id: string) {
  return client.warehouse.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      address: true,
      phone: true,
      priority: true,
      isActive: true,
      locations: { orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, code: true, description: true, isDefault: true, isActive: true } },
    },
  });
}

export async function existingWarehouseIds(client: DbClient, ids: readonly string[]): Promise<string[]> {
  const rows = await client.warehouse.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** A new warehouse starts with one default location, so stock can be received at once. */
export async function insertWarehouse(tx: Tx, data: WarehouseData): Promise<string> {
  const row = await tx.warehouse.create({
    data: { code: data.code, name: data.name, city: data.city, address: data.address, phone: data.phone, priority: data.priority, isActive: data.isActive },
    select: { id: true },
  });
  await tx.warehouseLocation.create({ data: { warehouseId: row.id, code: DEFAULT_LOCATION_CODE, isDefault: true } });
  return row.id;
}

export async function updateWarehouseRow(tx: Tx, id: string, data: WarehouseData): Promise<void> {
  await tx.warehouse.update({
    where: { id },
    data: { code: data.code, name: data.name, city: data.city, address: data.address, phone: data.phone, priority: data.priority, isActive: data.isActive },
  });
}

export async function getLocation(client: DbClient, id: string) {
  return client.warehouseLocation.findUnique({ where: { id }, select: { id: true, warehouseId: true, code: true, description: true, isDefault: true, isActive: true } });
}

/** Locks the warehouse row so default-location changes are serialized. */
async function lockWarehouse(tx: Tx, warehouseId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM warehouses WHERE id = ${warehouseId}::uuid FOR UPDATE`;
}

export async function insertLocation(tx: Tx, warehouseId: string, data: LocationData): Promise<string> {
  await lockWarehouse(tx, warehouseId);
  if (data.isDefault) await tx.warehouseLocation.updateMany({ where: { warehouseId, isDefault: true }, data: { isDefault: false } });
  const row = await tx.warehouseLocation.create({
    data: { warehouseId, code: data.code, description: data.description, isDefault: data.isDefault, isActive: data.isActive || data.isDefault },
    select: { id: true },
  });
  return row.id;
}

export async function updateLocationRow(tx: Tx, id: string, warehouseId: string, data: LocationData): Promise<void> {
  await lockWarehouse(tx, warehouseId);
  if (data.isDefault) await tx.warehouseLocation.updateMany({ where: { warehouseId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
  await tx.warehouseLocation.update({
    where: { id },
    // The default location stays active.
    data: { code: data.code, description: data.description, isDefault: data.isDefault, isActive: data.isActive || data.isDefault },
  });
}

/** Where a movement may be recorded: an active location of an active warehouse. */
export async function usableLocation(client: DbClient, locationId: string) {
  const row = await client.warehouseLocation.findUnique({
    where: { id: locationId },
    select: { id: true, warehouseId: true, isActive: true, warehouse: { select: { isActive: true } } },
  });
  return row && row.isActive && row.warehouse.isActive ? { id: row.id, warehouseId: row.warehouseId } : null;
}

/**
 * Inside the movement's transaction: locks the location and its warehouse
 * (FOR SHARE) and confirms both are still active, so a location switched
 * off at the same moment can't receive the movement.
 */
export async function lockUsableLocation(tx: Tx, locationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT (l.is_active AND w.is_active) AS ok
      FROM warehouse_locations l JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.id = ${locationId}::uuid
       FOR SHARE OF l, w`;
  return rows[0]?.ok === true;
}

/** Whether a location (or every location of a warehouse) still holds stock or reservations. */
export async function holdsStock(client: DbClient, where: { locationId: string } | { warehouseId: string }): Promise<boolean> {
  const count = await client.inventoryBalance.count({ where: { ...where, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] } });
  return count > 0;
}

// Products and stock -----------------------------------------------------------

export async function variantOfProduct(client: DbClient, variantId: string) {
  return client.productVariant.findFirst({ where: { id: variantId, deletedAt: null, product: { deletedAt: null } }, select: { id: true, productId: true } });
}

export async function productVariantIds(client: DbClient, productId: string) {
  return client.productVariant.findMany({
    where: { productId, deletedAt: null, product: { deletedAt: null } },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { sku: "asc" }],
    select: { id: true, sku: true, isDefault: true, isActive: true },
  });
}

export async function balancesFor(client: DbClient, variantIds: readonly string[], warehouseIds: readonly string[] | null) {
  return client.inventoryBalance.findMany({
    where: { variantId: { in: [...variantIds] }, ...inWarehouses(warehouseIds) },
    orderBy: [{ warehouse: { priority: "asc" } }, { warehouse: { code: "asc" } }, { location: { code: "asc" } }],
    select: {
      variantId: true,
      onHand: true,
      reserved: true,
      updatedAt: true,
      warehouse: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true } },
    },
  });
}

export async function movementsFor(client: DbClient, variantIds: readonly string[], warehouseIds: readonly string[] | null, take: number) {
  return client.inventoryMovement.findMany({
    where: { variantId: { in: [...variantIds] }, ...inWarehouses(warehouseIds) },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      variantId: true,
      type: true,
      quantity: true,
      onHandAfter: true,
      referenceCode: true,
      reason: true,
      occurredAt: true,
      warehouse: { select: { code: true } },
      balance: { select: { location: { select: { code: true } } } },
      actor: { select: { name: true } },
    },
  });
}

/** Active locations an actor can record movements at, grouped under their warehouse. */
export async function locationsIn(client: DbClient, warehouseIds: readonly string[] | null) {
  return client.warehouseLocation.findMany({
    where: { isActive: true, warehouse: { isActive: true }, ...inWarehouses(warehouseIds) },
    orderBy: [{ warehouse: { priority: "asc" } }, { warehouse: { code: "asc" } }, { isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, isDefault: true, warehouse: { select: { id: true, code: true, name: true } } },
  });
}

export interface MovementRow {
  variantId: string;
  locationId: string;
  warehouseId: string;
  type: MovementType;
  quantity: number;
  referenceType: MovementReferenceType;
  referenceId?: string | null;
  referenceCode: string | null;
  reason: string | null;
  actorUserId: string;
}

/** Inserts a movement; the database applies it to the balance and returns the new on-hand. */
export async function insertMovement(tx: Tx, row: MovementRow): Promise<{ id: string; onHandAfter: number }> {
  return tx.inventoryMovement.create({ data: { ...row, referenceId: row.referenceId ?? null }, select: { id: true, onHandAfter: true } });
}

/**
 * A manual adjustment applied at once by someone allowed to adjust: the
 * adjustment document, its single line and the movement, in one transaction.
 */
export async function insertAppliedAdjustment(
  tx: Tx,
  input: { warehouseId: string; locationId: string; variantId: string; delta: number; reason: AdjustmentReason; note: string | null; actorUserId: string; at: Date },
): Promise<{ adjustmentId: string; movementId: string; onHandAfter: number }> {
  const adjustment = await tx.stockAdjustment.create({
    data: { warehouseId: input.warehouseId, reason: input.reason, note: input.note, status: "applied", createdById: input.actorUserId, appliedById: input.actorUserId, appliedAt: input.at },
    select: { id: true },
  });
  const movement = await insertMovement(tx, {
    variantId: input.variantId,
    locationId: input.locationId,
    warehouseId: input.warehouseId,
    type: input.delta > 0 ? "adjustment_plus" : "adjustment_minus",
    quantity: Math.abs(input.delta),
    referenceType: "adjustment",
    referenceId: adjustment.id,
    referenceCode: null,
    reason: input.note,
    actorUserId: input.actorUserId,
  });
  await tx.stockAdjustmentLine.create({
    data: { adjustmentId: adjustment.id, variantId: input.variantId, locationId: input.locationId, quantityDelta: input.delta, movementId: movement.id },
  });
  return { adjustmentId: adjustment.id, movementId: movement.id, onHandAfter: movement.onHandAfter };
}

// Overview ---------------------------------------------------------------------

/** Stock per variant and warehouse, most recently changed first, optionally filtered by SKU. */
export async function stockOverview(
  client: DbClient,
  warehouseIds: readonly string[] | null,
  categoryIds: readonly string[] | null,
  skuNormalized: string | null,
  take: number,
) {
  // A product is in a category scope only when all its categories are (and it has one).
  const inCategories =
    categoryIds === null
      ? {}
      : {
          primaryCategoryId: { in: [...categoryIds] },
          categories: { every: { categoryId: { in: [...categoryIds] } } },
        };
  return client.inventoryBalance.findMany({
    where: {
      ...inWarehouses(warehouseIds),
      variant: { deletedAt: null, ...(skuNormalized ? { skuNormalized: { contains: skuNormalized } } : {}), product: { deletedAt: null, ...inCategories } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      onHand: true,
      reserved: true,
      updatedAt: true,
      warehouse: { select: { code: true } },
      location: { select: { code: true } },
      variant: {
        select: {
          sku: true,
          product: { select: { id: true, translations: { select: { locale: true, title: true } } } },
        },
      },
    },
  });
}

/** Sellable stock per variant: on hand minus reserved, in active locations of active warehouses. */
export async function availableByVariant(client: DbClient, variantIds: readonly string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await client.inventoryBalance.groupBy({
    by: ["variantId"],
    where: { variantId: { in: [...variantIds] }, location: { isActive: true }, warehouse: { isActive: true } },
    _sum: { onHand: true, reserved: true },
  });
  return new Map(rows.map((r) => [r.variantId, Math.max(0, (r._sum.onHand ?? 0) - (r._sum.reserved ?? 0))]));
}

// Reservations -----------------------------------------------------------------

/**
 * Reserves `quantity` of a variant for an order, taking stock from active
 * locations of active warehouses in priority order (default location first).
 * The balance rows are locked, and the reservation trigger refuses more than
 * is available, so two checkouts can never hold the same unit. Returns false
 * (and reserves nothing more) when there isn't enough.
 */
export async function reserveVariantForOrder(tx: Tx, input: { orderId: string; variantId: string; quantity: number; expiresAt: Date }): Promise<boolean> {
  const balances = await tx.$queryRaw<{ location_id: string; available: number }[]>`
    SELECT b.location_id, (b.on_hand - b.reserved)::int AS available
      FROM inventory_balances b
      JOIN warehouse_locations l ON l.id = b.location_id
      JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.variant_id = ${input.variantId}::uuid AND l.is_active AND w.is_active AND b.on_hand > b.reserved
     ORDER BY w.priority, w.code, l.is_default DESC, l.code
       FOR UPDATE OF b`;
  let left = input.quantity;
  const takes: { locationId: string; quantity: number }[] = [];
  for (const b of balances) {
    if (left <= 0) break;
    const take = Math.min(left, b.available);
    if (take > 0) takes.push({ locationId: b.location_id, quantity: take });
    left -= take;
  }
  if (left > 0) return false;
  await tx.stockReservation.createMany({
    data: takes.map((t) => ({ variantId: input.variantId, locationId: t.locationId, orderId: input.orderId, quantity: t.quantity, expiresAt: input.expiresAt })),
  });
  return true;
}
