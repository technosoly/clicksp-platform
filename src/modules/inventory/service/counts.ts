import "server-only";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import { cleanText } from "@/lib/i18n/names";
import { toEnDigits } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import { variantBySkuForAuthorization } from "@/modules/catalog/service/products";
import type { Actor } from "@/modules/rbac/domain/actor";
import { decide } from "@/modules/rbac/domain/authorize";
import { authorize, authorizeAny, AuthzError } from "@/modules/rbac/service/authorize";
import { MAX_MOVEMENT_QTY } from "../domain/inventory-input";
import { databaseMessage, insertMovement, isUniqueViolation, locationsIn, lockUsableLocation, usableLocation } from "../repo/inventory-repo";
import {
  addCountLine,
  COUNT_LINE_LIMIT,
  countedLines,
  countLines,
  finishCount,
  getCount,
  insertCount,
  linkCountMovement,
  listCounts,
  lockCount,
  setCountedQty,
} from "../repo/transfer-count-repo";

/**
 * Stock counts (stocktaking), per warehouse:
 *
 * - Starting a count (inventory.count) lists every product and location that
 *   holds stock there (or in one location). One open count per warehouse.
 * - People who count (inventory.count) type what they find on the shelf;
 *   each line then expects what the system shows at that moment, so sales
 *   and receipts during the count aren't counted twice. Products the list
 *   doesn't have can be added by SKU.
 * - Completing the count (inventory.adjust, Super and Business Admin)
 *   corrects stock by each counted line's difference with count_gain /
 *   count_loss movements, in one transaction. Lines left uncounted change
 *   nothing. A loss that would take stock below what open orders hold is
 *   refused, so the count can be fixed first.
 *
 * Store Staff count only in their warehouses and see only products of
 * their categories.
 */

export type CountResult = { status: "ok"; id: string; changed?: number } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "wrong_status" } | { status: "count_open" } | { status: "insufficient_stock"; sku?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;

function adminId(actor: Actor): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("inventory.count", "not_admin");
  return actor.userId;
}

const onWarehouse = (actor: Actor, permission: string, warehouseId: string, stepUp = true) =>
  authorize(actor, permission, { type: "warehouse", id: warehouseId, warehouseIds: [warehouseId] }, { stepUp });

function scope(actor: Actor): string[] | null {
  const grant = actor.permissions.get("inventory.count");
  return !grant || grant.unscoped ? null : [...grant.warehouseIds];
}

/** Categories whose products the actor sees: null = all. */
function productScope(actor: Actor): string[] | null {
  const grant = actor.permissions.get("product.view");
  return !grant ? [] : grant.unscoped ? null : [...grant.categoryIds];
}

const qty = z
  .string()
  .transform((v) => toEnDigits(v).trim())
  .pipe(z.string().regex(/^\d{1,7}$/, "invalid_quantity"))
  .transform(Number)
  .pipe(z.number().int().max(MAX_MOVEMENT_QTY, "invalid_quantity"));
const note = cleanText(1000, "invalid_text").transform((v) => v || null);

class Stop extends Error {
  constructor(readonly result: CountResult) {
    super(result.status);
  }
}

export async function listCountsForAdmin(actor: Actor) {
  adminId(actor);
  await authorizeAny(actor, ["inventory.count"], "inventory_counts");
  const s = scope(actor);
  const [counts, locations] = await Promise.all([listCounts(db(), s, 50), locationsIn(db(), s)]);
  return { counts, locations };
}

export async function startCount(actor: Actor, input: { warehouseId: string; locationId: string; note: string }): Promise<CountResult> {
  const userId = adminId(actor);
  if (!UUID.test(input.warehouseId)) return { status: "invalid", field: "invalid_warehouse" };
  await onWarehouse(actor, "inventory.count", input.warehouseId);
  let locationId: string | null = null;
  if (input.locationId) {
    const location = UUID.test(input.locationId) ? await usableLocation(db(), input.locationId) : null;
    if (!location || location.warehouseId !== input.warehouseId) return { status: "invalid", field: "invalid_location" };
    locationId = location.id;
  }
  const parsedNote = note.safeParse(input.note);
  if (!parsedNote.success) return { status: "invalid", field: "invalid_text" };
  if (!(await locationsIn(db(), [input.warehouseId])).length) return { status: "invalid", field: "invalid_warehouse" };
  try {
    const count = await transaction(async (tx) => {
      const count = await insertCount(tx, { warehouseId: input.warehouseId, locationId, note: parsedNote.data, startedById: userId });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_started", entityType: "inventory_count", entityId: count.id, after: { warehouseId: input.warehouseId, locationId, lines: count.lines } });
      return count;
    });
    return { status: "ok", id: count.id };
  } catch (error) {
    if (isUniqueViolation(error) || databaseMessage(error).includes("inventory_counts_one_open_per_warehouse")) return { status: "count_open" };
    throw error;
  }
}

/** A count with a page of its lines (products in the actor's categories), and what the actor may do. */
export async function getCountForAdmin(actor: Actor, id: string, page = 1, onlyUncounted = false) {
  adminId(actor);
  if (!UUID.test(id)) return null;
  const count = await getCount(db(), id);
  if (!count) return null;
  await onWarehouse(actor, "inventory.count", count.warehouseId, false);
  const current = Math.max(1, Math.min(page, Math.ceil(COUNT_LINE_LIMIT / PAGE)));
  const [lines, locations] = await Promise.all([
    countLines(db(), id, productScope(actor), { skip: (current - 1) * PAGE, take: PAGE, onlyUncounted }),
    locationsIn(db(), [count.warehouseId]),
  ]);
  const open = count.status === "open";
  return {
    count,
    lines: lines.rows,
    total: lines.total,
    counted: lines.counted,
    page: current,
    pages: Math.max(1, Math.ceil(lines.total / PAGE)),
    locations,
    can: {
      enter: open,
      complete: open && decide(actor.permissions, "inventory.adjust", { warehouseIds: [count.warehouseId] }).allowed,
      cancel: open,
    },
  };
}

/** Saves counted quantities typed on one page of the count; empty fields are skipped. */
export async function enterCounts(actor: Actor, countId: string, entries: readonly { lineId: string; quantity: string }[], now = new Date()): Promise<CountResult> {
  const userId = adminId(actor);
  if (!UUID.test(countId)) return { status: "not_found" };
  const count = await getCount(db(), countId);
  if (!count) return { status: "not_found" };
  await onWarehouse(actor, "inventory.count", count.warehouseId);
  const typed = entries.filter((e) => e.quantity.trim() !== "").slice(0, PAGE);
  const parsed: { lineId: string; quantity: number }[] = [];
  for (const entry of typed) {
    const q = qty.safeParse(entry.quantity);
    if (!q.success || !UUID.test(entry.lineId)) return { status: "invalid", field: "invalid_quantity" };
    parsed.push({ lineId: entry.lineId, quantity: q.data });
  }
  if (parsed.length === 0) return { status: "invalid", field: "nothing_counted" };
  const categories = productScope(actor);
  try {
    const saved = await transaction(async (tx) => {
      const locked = await lockCount(tx, countId);
      if (locked?.status !== "open") throw new Stop({ status: "wrong_status" });
      let saved = 0;
      for (const entry of parsed) if (await setCountedQty(tx, countId, entry.lineId, categories, entry.quantity, now)) saved++;
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_entered", entityType: "inventory_count", entityId: countId, after: { lines: parsed } });
      return saved;
    });
    return { status: "ok", id: countId, changed: saved };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    throw error;
  }
}

/** Adds a product found on a shelf that the count doesn't list. */
export async function addProductToCount(actor: Actor, countId: string, input: { sku: string; locationId: string }): Promise<CountResult> {
  const userId = adminId(actor);
  if (!UUID.test(countId)) return { status: "not_found" };
  const count = await getCount(db(), countId);
  if (!count) return { status: "not_found" };
  await onWarehouse(actor, "inventory.count", count.warehouseId);
  const location = UUID.test(input.locationId) ? await usableLocation(db(), input.locationId) : null;
  if (!location || location.warehouseId !== count.warehouseId) return { status: "invalid", field: "invalid_location" };
  const variant = await variantBySkuForAuthorization(input.sku);
  if (!variant) return { status: "invalid", field: "unknown_sku" };
  await authorize(actor, "product.view", { type: "product", id: variant.productId, categoryIds: variant.categoryIds }, { stepUp: false });
  try {
    await transaction(async (tx) => {
      const locked = await lockCount(tx, countId);
      if (locked?.status !== "open") throw new Stop({ status: "wrong_status" });
      if ((await addCountLine(tx, countId, variant.variantId, location.id)) === "exists") throw new Stop({ status: "invalid", field: "already_listed" });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_line_added", entityType: "inventory_count", entityId: countId, after: { sku: variant.sku, locationId: location.id } });
    });
  } catch (error) {
    if (error instanceof Stop) return error.result;
    throw error;
  }
  return { status: "ok", id: countId };
}

/** Applies the counted differences to stock and closes the count (inventory.adjust). */
export async function completeCount(actor: Actor, countId: string, now = new Date()): Promise<CountResult> {
  const userId = adminId(actor);
  if (!UUID.test(countId)) return { status: "not_found" };
  const count = await getCount(db(), countId);
  if (!count) return { status: "not_found" };
  await onWarehouse(actor, "inventory.adjust", count.warehouseId);
  let currentSku: string | undefined;
  try {
    const changed = await transaction(async (tx) => {
      const locked = await lockCount(tx, countId);
      if (locked?.status !== "open") throw new Stop({ status: "wrong_status" });
      const lines = await countedLines(tx, countId);
      const differences: { variantId: string; locationId: string; delta: number }[] = [];
      for (const line of lines) {
        const delta = line.countedQty! - line.expectedQty;
        if (delta === 0) continue;
        currentSku = line.variant.sku;
        if (!(await lockUsableLocation(tx, line.locationId))) throw new Stop({ status: "invalid", field: "invalid_location" });
        const movement = await insertMovement(tx, {
          variantId: line.variantId,
          locationId: line.locationId,
          warehouseId: locked.warehouse_id,
          type: delta > 0 ? "count_gain" : "count_loss",
          quantity: Math.abs(delta),
          referenceType: "count",
          referenceId: countId,
          referenceCode: null,
          reason: null,
          actorUserId: userId,
        });
        await linkCountMovement(tx, line.id, movement.id);
        differences.push({ variantId: line.variantId, locationId: line.locationId, delta });
      }
      currentSku = undefined;
      await finishCount(tx, countId, "completed", userId, now);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_completed", entityType: "inventory_count", entityId: countId, after: { counted: lines.length, differences } });
      return differences.length;
    });
    return { status: "ok", id: countId, changed };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    const message = databaseMessage(error);
    if (message.includes("inventory_balances_reserved_le_on_hand") || message.includes("inventory_balances_on_hand_non_negative")) {
      return { status: "insufficient_stock", sku: currentSku };
    }
    throw error;
  }
}

export async function cancelCount(actor: Actor, countId: string, now = new Date()): Promise<CountResult> {
  const userId = adminId(actor);
  if (!UUID.test(countId)) return { status: "not_found" };
  const count = await getCount(db(), countId);
  if (!count) return { status: "not_found" };
  await onWarehouse(actor, "inventory.count", count.warehouseId);
  return transaction(async (tx) => {
    const locked = await lockCount(tx, countId);
    if (locked?.status !== "open") return { status: "wrong_status" as const };
    await finishCount(tx, countId, "cancelled", userId, now);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_cancelled", entityType: "inventory_count", entityId: countId });
    return { status: "ok" as const, id: countId };
  });
}
