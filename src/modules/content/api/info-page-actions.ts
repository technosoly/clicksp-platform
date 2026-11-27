"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { saveInfoPage } from "../service/info-pages";

/** Server Action for the information pages; the service authorizes every call. */
export async function saveInfoPageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await saveInfoPage(actor, text(form, "key"), {
      faTitle: text(form, "faTitle"),
      faBody: text(form, "faBody"),
      enTitle: text(form, "enTitle"),
      enBody: text(form, "enBody"),
    });
    if (result.status === "ok") return { ok: true, message: "published" };
    if (result.status === "invalid") return { error: result.field };
    return { error: result.status };
  });
}
