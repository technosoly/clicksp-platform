"use server";

import { redirect } from "@/lib/i18n/navigation";
import { localeOf, runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { addProductToCount, cancelCount, completeCount, enterCounts, startCount } from "../service/counts";
import { advanceTransfer, createTransfer, removeTransferLine, setTransferLine } from "../service/transfers";
import type { MovementInput } from "../domain/inventory-input";
import { recordMovement } from "../service/stock";
import { createLocation, createWarehouse, updateLocation, updateWarehouse, type WarehouseResult } from "../service/warehouses";

/** Server Actions for warehouses and the stock card; the services authorize every call. */

function state(result: WarehouseResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  if (result.status === "invalid") return { error: result.field };
  if (result.status === "taken") return { error: "code_taken" };
  return { error: result.status };
}

const checked = (form: FormData, key: string) => form.get(key) === "on";

const warehouseFields = (form: FormData, isActive: boolean) => ({
  code: text(form, "code"),
  name: text(form, "name"),
  city: text(form, "city"),
  address: text(form, "address"),
  phone: text(form, "phone"),
  priority: text(form, "priority"),
  isActive,
});

export async function createWarehouseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createWarehouse(actor, warehouseFields(form, true)), "created"));
}

export async function updateWarehouseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateWarehouse(actor, text(form, "warehouseId"), warehouseFields(form, checked(form, "isActive"))), "saved"));
}

export async function createLocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(await createLocation(actor, text(form, "warehouseId"), { code: text(form, "code"), description: text(form, "description"), isDefault: checked(form, "isDefault"), isActive: true }), "created"),
  );
}

export async function updateLocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await updateLocation(actor, text(form, "warehouseId"), text(form, "locationId"), {
        code: text(form, "code"),
        description: text(form, "description"),
        isDefault: checked(form, "isDefault"),
        isActive: checked(form, "isActive"),
      }),
      "saved",
    ),
  );
}

export async function recordMovementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await recordMovement(actor, text(form, "productId"), {
      kind: text(form, "kind") as MovementInput["kind"],
      variantId: text(form, "variantId"),
      locationId: text(form, "locationId"),
      quantity: text(form, "quantity"),
      reference: text(form, "reference"),
      reason: text(form, "reason"),
      adjustmentReason: text(form, "adjustmentReason"),
    });
    if (result.status === "ok") return { ok: true, message: "movementRecorded" };
    if (result.status === "invalid") return { error: result.field };
    return { error: result.status };
  });
}

// Transfers and counts ----------------------------------------------------------

function docState(result: { status: string; field?: string; sku?: string }, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  if (result.status === "invalid" && result.field) return { error: result.field };
  return { error: result.status };
}

export async function createTransferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const state = await runAdminAction(form, async (actor) => {
    const result = await createTransfer(actor, { fromWarehouseId: text(form, "fromWarehouseId"), toWarehouseId: text(form, "toWarehouseId"), note: text(form, "note") });
    if (result.status === "ok") id = result.id;
    return docState(result, "created");
  });
  if (id) redirect({ href: `/admin/inventory/transfers/${id}`, locale: localeOf(form) });
  return state;
}

export async function setTransferLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    docState(
      await setTransferLine(actor, text(form, "transferId"), { sku: text(form, "sku"), quantity: text(form, "quantity"), fromLocationId: text(form, "fromLocationId"), toLocationId: text(form, "toLocationId") }),
      "saved",
    ),
  );
}

export async function removeTransferLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => docState(await removeTransferLine(actor, text(form, "transferId"), text(form, "lineId")), "removed"));
}

export async function advanceTransferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const step = text(form, "step");
    if (step !== "ship" && step !== "receive" && step !== "cancel") return { error: "invalid" };
    return docState(await advanceTransfer(actor, text(form, "transferId"), step), `transfer_${step}`);
  });
}

export async function startCountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const state = await runAdminAction(form, async (actor) => {
    const [warehouseId = "", locationId = ""] = text(form, "target").split(":");
    const result = await startCount(actor, { warehouseId, locationId, note: text(form, "note") });
    if (result.status === "ok") id = result.id;
    return docState(result, "created");
  });
  if (id) redirect({ href: `/admin/inventory/counts/${id}`, locale: localeOf(form) });
  return state;
}

export async function enterCountsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const entries = form.getAll("lineId").map((lineId) => ({ lineId: String(lineId), quantity: text(form, `qty-${String(lineId)}`) }));
    return docState(await enterCounts(actor, text(form, "countId"), entries), "saved");
  });
}

export async function addCountLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => docState(await addProductToCount(actor, text(form, "countId"), { sku: text(form, "sku"), locationId: text(form, "locationId") }), "added"));
}

export async function finishCountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const countId = text(form, "countId");
    if (text(form, "step") === "cancel") return docState(await cancelCount(actor, countId), "count_cancelled");
    return docState(await completeCount(actor, countId), "count_completed");
  });
}
