"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { cancelOrderByAdmin } from "../service/orders-admin";

/** Server Actions for the admin order screens; the service authorizes every call. */
export async function cancelOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await cancelOrderByAdmin(actor, text(form, "orderNumber"), text(form, "reason"));
    if (result.status === "ok") return { ok: true, message: "cancelled" };
    return { error: result.status === "invalid" ? result.field : result.status };
  });
}
