"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { SOCIAL_NETWORKS, type SocialNetwork } from "../domain/site-appearance";
import { saveSiteAppearance } from "../service/site-appearance";

/** Server Action for the site appearance settings; the service authorizes every call. */
export async function saveSiteAppearanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await saveSiteAppearance(actor, {
      nameFa: text(form, "nameFa"),
      nameEn: text(form, "nameEn"),
      taglineFa: text(form, "taglineFa"),
      taglineEn: text(form, "taglineEn"),
      seoTitleFa: text(form, "seoTitleFa"),
      seoTitleEn: text(form, "seoTitleEn"),
      seoDescriptionFa: text(form, "seoDescriptionFa"),
      seoDescriptionEn: text(form, "seoDescriptionEn"),
      footerNoteFa: text(form, "footerNoteFa"),
      footerNoteEn: text(form, "footerNoteEn"),
      social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, text(form, `social.${n}`)])) as Record<SocialNetwork, string>,
      announcementEnabled: form.get("announcementEnabled") === "on",
      announcementFa: text(form, "announcementFa"),
      announcementEn: text(form, "announcementEn"),
      announcementHref: text(form, "announcementHref"),
      announcementTone: text(form, "announcementTone"),
    });
    if (result.status === "ok") return { ok: true, message: "saved" };
    return { error: result.field };
  });
}
