import "server-only";
import { db, transaction } from "@/lib/db";
import { normalizeIdentifier, normalizeForStorage, toEnDigits } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import { productCategoriesForAuthorization } from "@/modules/catalog/service/products";
import type { Actor } from "@/modules/rbac/domain/actor";
import { decide } from "@/modules/rbac/domain/authorize";
import { authorize, authorizeAny, AuthzError } from "@/modules/rbac/service/authorize";
import { MOVEMENT_KINDS, MOVEMENT_PERMISSION, movementInputSchema, type MovementInput, type MovementKind } from "../domain/inventory-input";
import {
  closeOrderHolds,
  consumeOrderHolds,
  reserveVariantForOrder,
  availableByVariant,
  balancesFor,
  listWarehouses,
  databaseMessage,
  existingWarehouseIds,
  insertAppliedAdjustment,
  insertMovement,
  locationsIn,
  lockUsableLocation,
  movementsFor,
  productVariantIds,
  stockOverview,
  usableLocation,
  variantOfProduct,
} from "../repo/inventory-repo";

/**
 * Stock on hand per product variant, warehouse and location, and the manual
 * movements people record: receiving goods (inventory.receive), issuing them
 * for a reason (inventory.issue) and adjusting a count (inventory.adjust,
 * Super and Business Admin). Every permission is checked on the warehouse,
 * so Store Staff work only in the warehouses on their account.
 *
 * The database applies each movement to its balance under a row lock and
 * refuses stock below zero or below what open orders reserve, so two people
 * issuing the last unit at once can't both succeed.
 */

export type MovementResult = { status: "ok"; id: string; onHandAfter: number } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "insufficient_stock" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY = 30;
const OVERVIEW = 200;
/** At or below this many sellable units the shop says "only a few left". */
const LOW_STOCK = 3;

function adminId(actor: Actor, key: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(key, "not_admin");
  return actor.userId;
}

/** The warehouses a permission covers for this actor: null = all; undefined = not held. */
function warehouseScope(actor: Actor, key: string): string[] | null | undefined {
  const grant = actor.permissions.get(key);
  if (!grant) return undefined;
  return grant.unscoped ? null : [...grant.warehouseIds];
}

const allowedOn = (actor: Actor, key: string, warehouseId: string) => decide(actor.permissions, key, { warehouseIds: [warehouseId] }).allowed;

/**
 * The stock card of a product: balances and recent movements in the
 * warehouses the actor may view, and where they may record each kind of
 * movement. null when the actor can't view stock at all (the card is hidden).
 */
export async function productStockForAdmin(actor: Actor, productId: string) {
  adminId(actor, "inventory.view");
  const viewScope = warehouseScope(actor, "inventory.view");
  if (viewScope === undefined) return null;
  const categoryIds = UUID.test(productId) ? await productCategoriesForAuthorization(productId) : null;
  if (!categoryIds) return null;
  await authorize(actor, "product.view", { type: "product", id: productId, categoryIds }, { stepUp: false });

  const variants = await productVariantIds(db(), productId);
  const ids = variants.map((v) => v.id);
  const [balances, movements, locations] = await Promise.all([
    balancesFor(db(), ids, viewScope),
    movementsFor(db(), ids, viewScope, HISTORY),
    locationsIn(db(), null),
  ]);
  const recordable = locations
    .map((l) => ({ ...l, kinds: MOVEMENT_KINDS.filter((k) => allowedOn(actor, MOVEMENT_PERMISSION[k], l.warehouse.id)) }))
    .filter((l) => l.kinds.length > 0);
  const kinds = MOVEMENT_KINDS.filter((k) => recordable.some((l) => l.kinds.includes(k)));
  return { variants, balances, movements, locations: recordable, kinds };
}

class LocationClosed extends Error {}

function failure(error: unknown): MovementResult {
  if (error instanceof LocationClosed) return { status: "invalid", field: "invalid_location" };
  const message = databaseMessage(error);
  // Balances are whole numbers in PostgreSQL integer range.
  if (message.includes("out of range for type integer") || message.includes("22003")) return { status: "invalid", field: "invalid_quantity" };
  if (message.includes("inventory_balances_on_hand_non_negative") || message.includes("inventory_balances_reserved_le_on_hand")) {
    return { status: "insufficient_stock" };
  }
  throw error;
}

/** Records one movement typed on the stock card of a product. */
export async function recordMovement(actor: Actor, productId: string, input: MovementInput, now = new Date()): Promise<MovementResult> {
  const kindKey = MOVEMENT_KINDS.find((k) => k === input.kind);
  const userId = adminId(actor, kindKey ? MOVEMENT_PERMISSION[kindKey] : "inventory.receive");
  const parsed = movementInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const data = parsed.data;
  const location = await usableLocation(db(), data.locationId);
  if (!location) return { status: "invalid", field: "invalid_location" };
  const permission = MOVEMENT_PERMISSION[data.kind];
  await authorize(actor, permission, { type: "warehouse", id: location.warehouseId, warehouseIds: [location.warehouseId] });
  // The product must also be in the actor's categories, as on the stock card.
  const categoryIds = UUID.test(productId) ? await productCategoriesForAuthorization(productId) : null;
  if (!categoryIds) return { status: "not_found" };
  await authorize(actor, "product.view", { type: "product", id: productId, categoryIds }, { stepUp: false });
  const variant = await variantOfProduct(db(), data.variantId);
  if (!variant || variant.productId !== productId) return { status: "not_found" };

  try {
    return await transaction(async (tx) => {
      if (!(await lockUsableLocation(tx, location.id))) throw new LocationClosed();
      const common = { variantId: data.variantId, locationId: location.id, warehouseId: location.warehouseId, actorUserId: userId };
      let id: string;
      let onHandAfter: number;
      if (data.kind === "receive" || data.kind === "issue") {
        const movement = await insertMovement(tx, {
          ...common,
          type: data.kind === "receive" ? "receipt" : "issue",
          quantity: data.quantity,
          referenceType: data.kind === "receive" && data.reference ? "purchase" : "manual",
          referenceCode: data.reference,
          reason: data.reason,
        });
        ({ id, onHandAfter } = movement);
      } else {
        const adjustment = await insertAppliedAdjustment(tx, {
          ...common,
          delta: data.kind === "adjust_plus" ? data.quantity : -data.quantity,
          reason: data.adjustmentReason!,
          note: data.reason,
          at: now,
        });
        id = adjustment.movementId;
        onHandAfter = adjustment.onHandAfter;
      }
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: `inventory.${data.kind}`,
        entityType: "inventory_movement",
        entityId: id,
        after: { productId, variantId: data.variantId, warehouseId: location.warehouseId, locationId: location.id, quantity: data.quantity, onHandAfter, reference: data.reference, reason: data.reason, adjustmentReason: data.adjustmentReason },
      });
      return { status: "ok" as const, id, onHandAfter };
    });
  } catch (error) {
    return failure(error);
  }
}

/** Stock across the warehouses the actor may view, optionally filtered by SKU. */
export async function inventoryOverview(actor: Actor, skuInput = "") {
  adminId(actor, "inventory.view");
  await authorizeAny(actor, ["inventory.view"], "inventory");
  const scope = warehouseScope(actor, "inventory.view") ?? null;
  // Products are listed only where the actor may see them (product.view, by category).
  const productGrant = actor.permissions.get("product.view");
  const categoryIds = !productGrant ? [] : productGrant.unscoped ? null : [...productGrant.categoryIds];
  const sku = normalizeIdentifier(normalizeForStorage(toEnDigits(skuInput))).slice(0, 64);
  const rows = await stockOverview(db(), scope, categoryIds, sku || null, OVERVIEW);
  return { rows, sku: skuInput.slice(0, 64), limited: rows.length === OVERVIEW };
}

/**
 * Warehouses the actor can hand out on a staff account (those they can view
 * stock in themselves). The identity service re-checks coverage on save.
 */
export async function warehouseChoices(actor: Actor) {
  const scope = warehouseScope(actor, "inventory.view");
  if (scope === undefined) return [];
  await authorizeAny(actor, ["inventory.view"], "inventory");
  return listWarehouses(db(), scope);
}

/**
 * Which of these ids are warehouses. For other modules' input checks (the
 * staff scope screen); the caller authorizes its own action.
 */
export async function existingWarehouses(ids: readonly string[]): Promise<string[]> {
  return existingWarehouseIds(db(), ids);
}

export type { MovementKind };

/**
 * Whether each variant can be bought now, for the storefront. Public: it
 * says only in stock / low / out, never how many or where.
 */
export async function shopAvailability(variantIds: readonly string[]): Promise<Map<string, "in_stock" | "low" | "out">> {
  const ids = variantIds.filter((id) => UUID.test(id)).slice(0, 200);
  const available = await availableByVariant(db(), ids);
  return new Map(ids.map((id) => {
    const n = available.get(id) ?? 0;
    return [id, n <= 0 ? "out" : n <= LOW_STOCK ? "low" : "in_stock"] as const;
  }));
}

/**
 * Sellable quantity per variant, for server-side cart and checkout checks
 * only: never send these numbers to the browser (the shop shows
 * in stock / low / out).
 */
export async function sellableQuantities(variantIds: readonly string[]): Promise<Map<string, number>> {
  const ids = variantIds.filter((id) => UUID.test(id)).slice(0, 200);
  return availableByVariant(db(), ids);
}

/**
 * Holds stock for a new order, inside the order's transaction (called by the
 * sales checkout, which owns the customer's authorization). False when any
 * unit can't be held; the caller then rolls the whole order back.
 */
export async function reserveForOrder(tx: Parameters<typeof reserveVariantForOrder>[0], orderId: string, lines: readonly { variantId: string; quantity: number }[], expiresAt: Date): Promise<boolean> {
  // A fixed lock order (by variant id) so two checkouts can't deadlock.
  for (const line of [...lines].sort((x, y) => (x.variantId < y.variantId ? -1 : 1))) {
    if (!(await reserveVariantForOrder(tx, { orderId, variantId: line.variantId, quantity: line.quantity, expiresAt }))) return false;
  }
  return true;
}

/** Takes an order's held stock off the shelf as sales when it ships (inside the caller's transaction). */
export async function takeOrderStock(tx: Parameters<typeof consumeOrderHolds>[0], orderId: string, actorUserId: string, trackingCode: string | null) {
  return consumeOrderHolds(tx, orderId, actorUserId, trackingCode);
}

/** Gives back the stock held for an order (inside the caller's transaction). */
export async function releaseOrderHolds(tx: Parameters<typeof closeOrderHolds>[0], orderId: string, reason: "released" | "expired"): Promise<void> {
  await closeOrderHolds(tx, orderId, reason);
}
