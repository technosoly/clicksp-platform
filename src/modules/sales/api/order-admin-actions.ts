"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { fulfilOrder, FULFIL_STEPS, type FulfilStep } from "../service/fulfilment";
import { cancelOrderByAdmin } from "../service/orders-admin";

/** Server Actions for the admin order screens; the service authorizes every call. */
export async function cancelOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await cancelOrderByAdmin(actor, text(form, "orderNumber"), text(form, "reason"));
    if (result.status === "ok") return { ok: true, message: "cancelled" };
    return { error: result.status === "invalid" ? result.field : result.status };
  });
}

/** Pack, ship (with an optional tracking code) or mark delivered. */
export async function fulfilOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const step = text(form, "step");
    if (!(step in FULFIL_STEPS)) return { error: "unexpected" };
    const result = await fulfilOrder(actor, text(form, "orderNumber"), step as FulfilStep, { trackingCode: text(form, "trackingCode") });
    if (result.status === "ok") return { ok: true, message: step };
    return { error: result.status === "invalid" ? result.field : result.status };
  });
}
