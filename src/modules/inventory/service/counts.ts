import "server-only";
import { z } from "zod";
import { db, isDeadlock, transaction } from "@/lib/db";
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
  countedLineCount,
  countedLines,
  countLines,
  finishCount,
  getCount,
  insertCount,
  linkCountMovement,
  listCounts,
  lockCount,
  setCountedQty,
  stockedRows,
  type CountEntryChange,
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
 * their categories. People who only count don't see the expected quantity
 * (a blind count); those who can complete the count do. A count is
 * cancelled by whoever started it or by someone who can complete it.
 */

export type CountResult = { status: "ok"; id: string; changed?: number } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "wrong_status" } | { status: "count_open" } | { status: "insufficient_stock"; sku?: string } | { status: "busy" };

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
  if ((await stockedRows(db(), input.warehouseId, locationId)) > COUNT_LINE_LIMIT) return { status: "invalid", field: "too_many_lines" };
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
  // A count holds at most COUNT_LINE_LIMIT lines, plus a few added by hand.
  const current = Math.min(Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)), 2 * Math.ceil(COUNT_LINE_LIMIT / PAGE));
  const [lines, locations] = await Promise.all([
    countLines(db(), id, productScope(actor), { skip: (current - 1) * PAGE, take: PAGE, onlyUncounted }),
    locationsIn(db(), [count.warehouseId]),
  ]);
  const open = count.status === "open";
  const adjusts = decide(actor.permissions, "inventory.adjust", { warehouseIds: [count.warehouseId] }).allowed;
  return {
    count,
    // Blind count: the expected quantity is shown only to those who complete counts.
    lines: lines.rows.map((line) => ({ ...line, expectedQty: adjusts || !open ? line.expectedQty : null })),
    showExpected: adjusts || !open,
    total: lines.total,
    counted: lines.counted,
    page: current,
    pages: Math.max(1, Math.ceil(lines.total / PAGE)),
    locations,
    can: {
      enter: open,
      complete: open && adjusts,
      cancel: open && (adjusts || count.startedById === actor.userId),
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
      const changes: CountEntryChange[] = [];
      for (const entry of parsed) {
        const change = await setCountedQty(tx, countId, entry.lineId, categories, entry.quantity, now);
        if (change && change !== "unchanged") changes.push(change);
      }
      if (changes.length > 0) {
        await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_entered", entityType: "inventory_count", entityId: countId, after: { lines: changes } });
      }
      return changes.length;
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
      const added = await addCountLine(tx, countId, variant.variantId, location.id);
      if (added === "exists") throw new Stop({ status: "invalid", field: "already_listed" });
      if (added === "full") throw new Stop({ status: "invalid", field: "too_many_lines" });
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
    }, { timeoutMs: 120_000 });
    return { status: "ok", id: countId, changed };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    if (isDeadlock(error)) return { status: "busy" };
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
  // Cancelling throws away everyone's counting: only whoever started the count, or someone who completes counts.
  if (count.startedById !== userId) await onWarehouse(actor, "inventory.adjust", count.warehouseId);
  return transaction(async (tx) => {
    const locked = await lockCount(tx, countId);
    if (locked?.status !== "open") return { status: "wrong_status" as const };
    const counted = await countedLineCount(tx, countId);
    await finishCount(tx, countId, "cancelled", userId, now);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.count_cancelled", entityType: "inventory_count", entityId: countId, before: { status: "open", countedLines: counted } });
    return { status: "ok" as const, id: countId };
  });
}
