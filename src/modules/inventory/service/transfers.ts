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
import { databaseMessage, insertMovement, lockUsableLocation, locationsIn, usableLocation } from "../repo/inventory-repo";
import {
  deleteTransferLine,
  getTransfer,
  insertTransfer,
  listTransfers,
  lockTransfer,
  setTransferStatus,
  transferLineIdsInScope,
  transferLines,
  upsertTransferLine,
} from "../repo/transfer-count-repo";

/**
 * Stock transfers between warehouses (inventory.transfer, on the warehouse):
 *
 *   draft --ship--> in_transit --receive--> received
 *     \                  \
 *      cancel             cancel (the stock goes back where it came from)
 *
 * Shipping takes the stock out of the source locations (transfer_out
 * movements) and refuses more than is free there; receiving puts it into the
 * destination locations (transfer_in). Between the two the goods are on the
 * road and in neither warehouse's stock. Creating a transfer and editing its
 * lines needs the permission in both warehouses; shipping and cancelling in
 * the source, receiving in the destination. Cancelling a transfer already
 * on the road puts the stock back at the source, so it needs the permission
 * in both warehouses (the destination may already hold the goods).
 *
 * A transfer is one document: people whose product.view is limited to some
 * categories see only the lines of those categories, and can't change, ship,
 * receive or cancel a transfer that holds products outside them. Every step
 * is audited.
 */

export type TransferResult =
  | { status: "ok"; id: string }
  | { status: "not_found" }
  | { status: "invalid"; field: string }
  | { status: "wrong_status" }
  | { status: "insufficient_stock"; sku?: string }
  | { status: "busy" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = 50;

function adminId(actor: Actor): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("inventory.transfer", "not_admin");
  return actor.userId;
}

const onWarehouse = (actor: Actor, warehouseId: string) =>
  authorize(actor, "inventory.transfer", { type: "warehouse", id: warehouseId, warehouseIds: [warehouseId] });

const allowedOn = (actor: Actor, warehouseId: string) => decide(actor.permissions, "inventory.transfer", { warehouseIds: [warehouseId] }).allowed;

function scope(actor: Actor): string[] | null {
  const grant = actor.permissions.get("inventory.transfer");
  return !grant || grant.unscoped ? null : [...grant.warehouseIds];
}

const quantity = z
  .string()
  .transform((v) => toEnDigits(v).trim())
  .pipe(z.string().regex(/^\d{1,7}$/, "invalid_quantity"))
  .transform(Number)
  .pipe(z.number().int().min(1, "invalid_quantity").max(MAX_MOVEMENT_QTY, "invalid_quantity"));
const note = cleanText(1000, "invalid_text").transform((v) => v || null);

class Stop extends Error {
  constructor(readonly result: TransferResult) {
    super(result.status);
  }
}

/** Categories whose products the actor sees: null = all. */
function productScope(actor: Actor): string[] | null {
  const grant = actor.permissions.get("product.view");
  return !grant ? [] : grant.unscoped ? null : [...grant.categoryIds];
}

/** Refuses when the transfer holds a product outside the actor's categories. */
async function requireWholeTransfer(actor: Actor, transferId: string, lineCount: number): Promise<void> {
  const categories = productScope(actor);
  if (categories === null) return;
  if ((await transferLineIdsInScope(db(), transferId, categories)).size !== lineCount) throw new AuthzError("product.view", "out_of_scope");
}

function stockFailure(error: unknown, sku?: string): TransferResult {
  if (error instanceof Stop) return error.result;
  if (isDeadlock(error)) return { status: "busy" };
  const message = databaseMessage(error);
  if (message.includes("inventory_balances_on_hand_non_negative") || message.includes("inventory_balances_reserved_le_on_hand")) return { status: "insufficient_stock", sku };
  if (message.includes("out of range for type integer")) return { status: "invalid", field: "invalid_quantity" };
  throw error;
}

export async function listTransfersForAdmin(actor: Actor) {
  adminId(actor);
  await authorizeAny(actor, ["inventory.transfer"], "inventory_transfers");
  return listTransfers(db(), scope(actor), LIST);
}

/** Locations the actor can move stock between (active, in warehouses they transfer in). */
export async function transferLocations(actor: Actor) {
  adminId(actor);
  await authorizeAny(actor, ["inventory.transfer"], "inventory_transfers");
  return locationsIn(db(), scope(actor));
}

/** A transfer the actor may see (they transfer in its source or destination), with what they may do next. */
export async function getTransferForAdmin(actor: Actor, id: string) {
  adminId(actor);
  await authorizeAny(actor, ["inventory.transfer"], "inventory_transfers");
  if (!UUID.test(id)) return null;
  const transfer = await getTransfer(db(), id);
  if (!transfer) return null;
  const atSource = allowedOn(actor, transfer.fromWarehouseId);
  const atDestination = allowedOn(actor, transfer.toWarehouseId);
  if (!atSource && !atDestination) return null;
  const categories = productScope(actor);
  const [locations, visible] = await Promise.all([
    locationsIn(db(), [transfer.fromWarehouseId, transfer.toWarehouseId]),
    categories === null ? null : transferLineIdsInScope(db(), transfer.id, categories),
  ]);
  const lines = visible === null ? transfer.lines : transfer.lines.filter((l) => visible.has(l.id));
  const hiddenLines = transfer.lines.length - lines.length;
  const whole = hiddenLines === 0;
  return {
    transfer: { ...transfer, lines },
    hiddenLines,
    locations,
    can: {
      edit: whole && transfer.status === "draft" && atSource && atDestination,
      ship: whole && transfer.status === "draft" && atSource && lines.length > 0,
      receive: whole && transfer.status === "in_transit" && atDestination,
      cancel: whole && ((transfer.status === "draft" && atSource) || (transfer.status === "in_transit" && atSource && atDestination)),
    },
  };
}

/** A new draft transfer from one warehouse to another. */
export async function createTransfer(actor: Actor, input: { fromWarehouseId: string; toWarehouseId: string; note: string }): Promise<TransferResult> {
  const userId = adminId(actor);
  if (!UUID.test(input.fromWarehouseId) || !UUID.test(input.toWarehouseId)) return { status: "invalid", field: "invalid_warehouse" };
  if (input.fromWarehouseId === input.toWarehouseId) return { status: "invalid", field: "same_warehouse" };
  await onWarehouse(actor, input.fromWarehouseId);
  await onWarehouse(actor, input.toWarehouseId);
  const parsedNote = note.safeParse(input.note);
  if (!parsedNote.success) return { status: "invalid", field: "invalid_text" };
  const active = await locationsIn(db(), [input.fromWarehouseId, input.toWarehouseId]);
  if (!active.some((l) => l.warehouse.id === input.fromWarehouseId) || !active.some((l) => l.warehouse.id === input.toWarehouseId)) {
    return { status: "invalid", field: "invalid_warehouse" };
  }
  const id = await transaction(async (tx) => {
    const id = await insertTransfer(tx, { fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, note: parsedNote.data, createdById: userId });
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.transfer_created", entityType: "stock_transfer", entityId: id, after: { fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId } });
    return id;
  });
  return { status: "ok", id };
}

/** Adds a product (by SKU) to a draft transfer, or changes its quantity. */
export async function setTransferLine(
  actor: Actor,
  transferId: string,
  input: { sku: string; quantity: string; fromLocationId: string; toLocationId: string },
): Promise<TransferResult> {
  const userId = adminId(actor);
  if (!UUID.test(transferId)) return { status: "not_found" };
  const transfer = await getTransfer(db(), transferId);
  if (!transfer) return { status: "not_found" };
  await onWarehouse(actor, transfer.fromWarehouseId);
  await onWarehouse(actor, transfer.toWarehouseId);
  if (transfer.status !== "draft") return { status: "wrong_status" };
  const qty = quantity.safeParse(input.quantity);
  if (!qty.success) return { status: "invalid", field: "invalid_quantity" };
  const [from, to] = await Promise.all([
    UUID.test(input.fromLocationId) ? usableLocation(db(), input.fromLocationId) : null,
    UUID.test(input.toLocationId) ? usableLocation(db(), input.toLocationId) : null,
  ]);
  if (!from || from.warehouseId !== transfer.fromWarehouseId || !to || to.warehouseId !== transfer.toWarehouseId) return { status: "invalid", field: "invalid_location" };
  const variant = await variantBySkuForAuthorization(input.sku);
  if (!variant) return { status: "invalid", field: "unknown_sku" };
  await authorize(actor, "product.view", { type: "product", id: variant.productId, categoryIds: variant.categoryIds }, { stepUp: false });
  try {
    await transaction(async (tx) => {
      const locked = await lockTransfer(tx, transferId);
      if (locked?.status !== "draft") throw new Stop({ status: "wrong_status" });
      const lineId = await upsertTransferLine(tx, { transferId, variantId: variant.variantId, fromLocationId: from.id, toLocationId: to.id, quantity: qty.data });
      if (lineId === "full") throw new Stop({ status: "invalid", field: "too_many_lines" });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.transfer_line_set", entityType: "stock_transfer", entityId: transferId, after: { lineId, sku: variant.sku, quantity: qty.data, fromLocationId: from.id, toLocationId: to.id } });
    });
  } catch (error) {
    return stockFailure(error);
  }
  return { status: "ok", id: transferId };
}

export async function removeTransferLine(actor: Actor, transferId: string, lineId: string): Promise<TransferResult> {
  const userId = adminId(actor);
  if (!UUID.test(transferId) || !UUID.test(lineId)) return { status: "not_found" };
  const transfer = await getTransfer(db(), transferId);
  if (!transfer) return { status: "not_found" };
  await onWarehouse(actor, transfer.fromWarehouseId);
  await onWarehouse(actor, transfer.toWarehouseId);
  const categories = productScope(actor);
  if (categories !== null && transfer.lines.some((l) => l.id === lineId) && !(await transferLineIdsInScope(db(), transferId, categories)).has(lineId)) {
    throw new AuthzError("product.view", "out_of_scope");
  }
  try {
    return await transaction(async (tx) => {
      const locked = await lockTransfer(tx, transferId);
      if (locked?.status !== "draft") return { status: "wrong_status" as const };
      const removed = await deleteTransferLine(tx, transferId, lineId);
      if (!removed) return { status: "not_found" as const };
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "inventory.transfer_line_removed", entityType: "stock_transfer", entityId: transferId, before: removed });
      return { status: "ok" as const, id: transferId };
    });
  } catch (error) {
    return stockFailure(error);
  }
}

type Step = "ship" | "receive" | "cancel";

/**
 * Moves a transfer to its next status and writes the stock movements, all in
 * one transaction under a lock on the transfer, so a transfer is shipped or
 * received once however many people press the button.
 */
export async function advanceTransfer(actor: Actor, transferId: string, step: Step, now = new Date()): Promise<TransferResult> {
  const userId = adminId(actor);
  if (!UUID.test(transferId)) return { status: "not_found" };
  const transfer = await getTransfer(db(), transferId);
  if (!transfer) return { status: "not_found" };
  await onWarehouse(actor, step === "receive" ? transfer.toWarehouseId : transfer.fromWarehouseId);
  await requireWholeTransfer(actor, transferId, transfer.lines.length);
  const skuOf = new Map(transfer.lines.map((l) => [l.variant.id, l.variant.sku]));
  let currentSku: string | undefined;
  try {
    await transaction(async (tx) => {
      const locked = await lockTransfer(tx, transferId);
      if (!locked) throw new Stop({ status: "not_found" });
      const from = locked.status;
      const allowed = step === "ship" ? from === "draft" : step === "receive" ? from === "in_transit" : from === "draft" || from === "in_transit";
      if (!allowed) throw new Stop({ status: "wrong_status" });
      // Goods on the road may already be at the destination: putting them back needs both sides.
      if (step === "cancel" && from === "in_transit") await onWarehouse(actor, locked.to_warehouse_id);
      const locationOf = (l: { fromLocationId: string; toLocationId: string }) => (step === "receive" ? l.toLocationId : l.fromLocationId);
      // Same lock order everywhere (location, then product), so two stock changes never wait on each other in a circle.
      const lines = (await transferLines(tx, transferId)).sort((a, b) => locationOf(a).localeCompare(locationOf(b)) || a.variantId.localeCompare(b.variantId));
      if (lines.length !== transfer.lines.length) throw new Stop({ status: "wrong_status" });
      if (step === "ship" && lines.length === 0) throw new Stop({ status: "invalid", field: "no_lines" });
      // Draft transfers have moved no stock; others move it out, in, or back.
      if (step !== "cancel" || from === "in_transit") {
        for (const line of lines) {
          currentSku = skuOf.get(line.variantId);
          const out = step === "ship";
          const locationId = locationOf(line);
          const warehouseId = step === "receive" ? locked.to_warehouse_id : locked.from_warehouse_id;
          if (!(await lockUsableLocation(tx, locationId))) throw new Stop({ status: "invalid", field: "invalid_location" });
          await insertMovement(tx, {
            variantId: line.variantId,
            locationId,
            warehouseId,
            type: out ? "transfer_out" : "transfer_in",
            quantity: line.quantity,
            referenceType: "transfer",
            referenceId: transferId,
            transferId,
            referenceCode: null,
            reason: step === "cancel" ? "transfer cancelled" : null,
            actorUserId: userId,
          });
        }
      }
      currentSku = undefined;
      await setTransferStatus(tx, transferId, step === "ship" ? "in_transit" : step === "receive" ? "received" : "cancelled", now);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: `inventory.transfer_${step === "ship" ? "shipped" : step === "receive" ? "received" : "cancelled"}`,
        entityType: "stock_transfer",
        entityId: transferId,
        before: { status: from },
        after: { lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) },
      });
    }, { timeoutMs: 60_000 });
  } catch (error) {
    return stockFailure(error, currentSku);
  }
  return { status: "ok", id: transferId };
}
