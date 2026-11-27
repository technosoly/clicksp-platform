import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { locationInputSchema, warehouseInputSchema, type LocationInput, type WarehouseInput } from "../domain/inventory-input";
import {
  databaseMessage,
  getLocation,
  getWarehouse,
  insertLocation,
  insertWarehouse,
  isUniqueViolation,
  listWarehouses,
  updateLocationRow,
  updateWarehouseRow,
} from "../repo/inventory-repo";

/**
 * Warehouses and their storage locations (warehouse.manage: Super and
 * Business Admin). Real data only: nothing is seeded. Every change is audited.
 */

export type WarehouseResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "taken" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tx = Parameters<Parameters<typeof transaction>[0]>[0];

async function allow(actor: Actor, stepUp = true): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("warehouse.manage", "not_admin");
  await authorize(actor, "warehouse.manage", { type: "warehouse" }, { stepUp });
  return actor.userId;
}

function failure(error: unknown): WarehouseResult {
  if (isUniqueViolation(error)) return { status: "taken" };
  if (databaseMessage(error).includes("code_format")) return { status: "invalid", field: "invalid_code" };
  throw error;
}

async function write(actor: Actor, userId: string, action: string, entityType: string, fn: (tx: Tx) => Promise<{ id: string; before?: unknown }>, after: unknown): Promise<WarehouseResult> {
  try {
    const id = await transaction(async (tx) => {
      const { id, before } = await fn(tx);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action, entityType, entityId: id, before, after });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}

const first = (issues: { message: string }[]) => issues[0]?.message ?? "invalid";

export async function listWarehousesForAdmin(actor: Actor) {
  await allow(actor, false);
  return listWarehouses(db(), null);
}

export async function getWarehouseForAdmin(actor: Actor, id: string) {
  await allow(actor, false);
  return UUID.test(id) ? getWarehouse(db(), id) : null;
}

export async function createWarehouse(actor: Actor, input: WarehouseInput): Promise<WarehouseResult> {
  const userId = await allow(actor);
  const parsed = warehouseInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "warehouse.created", "warehouse", async (tx) => ({ id: await insertWarehouse(tx, parsed.data) }), parsed.data);
}

export async function updateWarehouse(actor: Actor, id: string, input: WarehouseInput): Promise<WarehouseResult> {
  const userId = await allow(actor);
  if (!UUID.test(id)) return { status: "not_found" };
  const parsed = warehouseInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  const before = await getWarehouse(db(), id);
  if (!before) return { status: "not_found" };
  const beforeRow = { code: before.code, name: before.name, city: before.city, address: before.address, phone: before.phone, priority: before.priority, isActive: before.isActive };
  return write(actor, userId, "warehouse.updated", "warehouse", async (tx) => {
    await updateWarehouseRow(tx, id, parsed.data);
    return { id, before: beforeRow };
  }, parsed.data);
}

export async function createLocation(actor: Actor, warehouseId: string, input: LocationInput): Promise<WarehouseResult> {
  const userId = await allow(actor);
  if (!UUID.test(warehouseId) || !(await getWarehouse(db(), warehouseId))) return { status: "not_found" };
  const parsed = locationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "warehouse.location_created", "warehouse_location", async (tx) => ({ id: await insertLocation(tx, warehouseId, parsed.data) }), { warehouseId, ...parsed.data });
}

export async function updateLocation(actor: Actor, warehouseId: string, id: string, input: LocationInput): Promise<WarehouseResult> {
  const userId = await allow(actor);
  const before = UUID.test(id) ? await getLocation(db(), id) : null;
  if (!before || before.warehouseId !== warehouseId) return { status: "not_found" };
  const parsed = locationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  // The default location can be replaced by making another one default, not switched off.
  if (before.isDefault && !parsed.data.isDefault) return { status: "invalid", field: "default_location_required" };
  return write(actor, userId, "warehouse.location_updated", "warehouse_location", async (tx) => {
    await updateLocationRow(tx, id, warehouseId, parsed.data);
    return { id, before };
  }, parsed.data);
}
