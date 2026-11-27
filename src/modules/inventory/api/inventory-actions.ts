"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
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
