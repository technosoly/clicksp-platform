"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { addRate, createMethod, createZone, removeRate, updateMethod, updateZone, type ShippingResult } from "../service/shipping-admin";

/** Server Actions for shipping settings; the services authorize every call. */

function state(result: ShippingResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  if (result.status === "invalid") return { error: result.field };
  if (result.status === "taken") return { error: "code_taken" };
  return { error: result.status };
}

const checked = (form: FormData, key: string) => form.get(key) === "on";

const zoneFields = (form: FormData, isActive: boolean) => ({
  code: text(form, "code"),
  faName: text(form, "faName"),
  enName: text(form, "enName"),
  provinces: form.getAll("provinces").filter((v): v is string => typeof v === "string"),
  isActive,
});

const methodFields = (form: FormData, isActive: boolean) => ({
  code: text(form, "code"),
  kind: text(form, "kind"),
  faName: text(form, "faName"),
  enName: text(form, "enName"),
  faDescription: text(form, "faDescription"),
  enDescription: text(form, "enDescription"),
  minDays: text(form, "minDays"),
  maxDays: text(form, "maxDays"),
  sortOrder: text(form, "sortOrder"),
  isActive,
});

export async function createZoneAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createZone(actor, zoneFields(form, true)), "created"));
}

export async function updateZoneAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateZone(actor, text(form, "zoneId"), zoneFields(form, checked(form, "isActive"))), "saved"));
}

export async function createMethodAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createMethod(actor, methodFields(form, checked(form, "isActive"))), "created"));
}

export async function updateMethodAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateMethod(actor, text(form, "methodId"), methodFields(form, checked(form, "isActive"))), "saved"));
}

export async function addRateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await addRate(actor, text(form, "methodId"), {
        zoneId: text(form, "zoneId"),
        baseAmount: text(form, "baseAmount"),
        perKgAmount: text(form, "perKgAmount"),
        freeAbove: text(form, "freeAbove"),
        minWeightGrams: text(form, "minWeightGrams"),
        maxWeightGrams: text(form, "maxWeightGrams"),
      }),
      "created",
    ),
  );
}

export async function removeRateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await removeRate(actor, text(form, "methodId"), text(form, "rateId")), "removed"));
}
