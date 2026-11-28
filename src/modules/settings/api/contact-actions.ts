"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { saveContactInfo } from "../service/contact-info";

/** Server Action for the contact details; the service authorizes every call. */
export async function saveContactInfoAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await saveContactInfo(actor, {
      addressFa: text(form, "addressFa"),
      addressEn: text(form, "addressEn"),
      hoursFa: text(form, "hoursFa"),
      hoursEn: text(form, "hoursEn"),
      phones: [text(form, "phone1"), text(form, "phone2"), text(form, "phone3")],
      email: text(form, "email"),
      google: text(form, "google"),
      neshan: text(form, "neshan"),
      balad: text(form, "balad"),
      googleEmbed: text(form, "googleEmbed"),
    });
    if (result.status === "ok") return { ok: true, message: "saved" };
    return { error: result.field };
  });
}
