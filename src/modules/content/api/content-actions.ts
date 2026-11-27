"use server";

import { redirect } from "@/lib/i18n/navigation";
import { localeOf, runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import type { UploadedFile } from "@/modules/media/service/images";
import type { ArticleInput } from "../domain/article";
import type { BannerTextInput } from "../domain/banner";
import { MENU_ROWS, isMenuKey } from "../domain/menu";
import { createArticle, deleteArticle, saveArticle, setArticleCover, type ArticleResult } from "../service/articles";
import { createBanner, deleteBanner, saveBanner, setBannerImage, type BannerResult } from "../service/banners";
import { saveMenu } from "../service/menus";

/** Server Actions for articles, menus and banners; the services authorize every call. */

const checked = (form: FormData, key: string) => form.get(key) === "on";

function state(result: ArticleResult | BannerResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" ? result.field : result.status };
}

async function imageFile(form: FormData): Promise<UploadedFile | null> {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const articleInput = (form: FormData): ArticleInput => ({
  status: text(form, "status"),
  faTitle: text(form, "faTitle"),
  faSlug: text(form, "faSlug"),
  faExcerpt: text(form, "faExcerpt"),
  faBody: text(form, "faBody"),
  enTitle: text(form, "enTitle"),
  enSlug: text(form, "enSlug"),
  enExcerpt: text(form, "enExcerpt"),
  enBody: text(form, "enBody"),
});

export async function createArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const result = await runAdminAction(form, async (actor) => {
    const r = await createArticle(actor, articleInput(form));
    if (r.status === "ok") id = r.id;
    return state(r, "created");
  });
  if (id) redirect({ href: `/admin/articles/${id}?created=1`, locale: localeOf(form) });
  return result;
}

export async function saveArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await saveArticle(actor, text(form, "articleId"), articleInput(form)), "saved"));
}

export async function articleCoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const remove = text(form, "command") === "remove";
    const file = remove ? null : await imageFile(form);
    if (!remove && !file) return { error: "image_missing" };
    return state(await setArticleCover(actor, text(form, "articleId"), file), remove ? "imageRemoved" : "imageAdded");
  });
}

export async function deleteArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let done = false;
  const result = await runAdminAction(form, async (actor) => {
    if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
    const r = await deleteArticle(actor, text(form, "articleId"));
    done = r.status === "ok";
    return state(r, "deleted");
  });
  if (done) redirect({ href: "/admin/articles?deleted=1", locale: localeOf(form) });
  return result;
}

export async function saveMenuAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const key = text(form, "key");
    if (!isMenuKey(key)) return { error: "not_found" };
    const rows = Array.from({ length: MENU_ROWS[key] }, (_, i) => ({ fa: text(form, `fa-${i}`), en: text(form, `en-${i}`), href: text(form, `href-${i}`) }));
    const r = await saveMenu(actor, key, rows);
    if (r.status === "ok") return { ok: true, message: "saved" };
    if (r.status === "invalid") return { error: r.field };
    return { error: r.status };
  });
}

const bannerInput = (form: FormData): BannerTextInput => ({
  faTitle: text(form, "faTitle"),
  faSubtitle: text(form, "faSubtitle"),
  faCta: text(form, "faCta"),
  faAlt: text(form, "faAlt"),
  enTitle: text(form, "enTitle"),
  enSubtitle: text(form, "enSubtitle"),
  enCta: text(form, "enCta"),
  enAlt: text(form, "enAlt"),
  href: text(form, "href"),
  sortOrder: text(form, "sortOrder"),
  isActive: checked(form, "isActive"),
  startsOn: text(form, "startsOn"),
  endsOn: text(form, "endsOn"),
});

export async function createBannerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const result = await runAdminAction(form, async (actor) => {
    const r = await createBanner(actor, text(form, "placement"), bannerInput(form), await imageFile(form));
    if (r.status === "ok") id = r.id;
    return state(r, "created");
  });
  if (id) redirect({ href: `/admin/banners/${id}?created=1`, locale: localeOf(form) });
  return result;
}

export async function saveBannerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await saveBanner(actor, text(form, "bannerId"), bannerInput(form)), "saved"));
}

export async function bannerImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const which = text(form, "which") === "mobile" ? "mobile" : "desktop";
    const remove = text(form, "command") === "remove";
    const file = remove ? null : await imageFile(form);
    if (!remove && !file) return { error: "image_missing" };
    return state(await setBannerImage(actor, text(form, "bannerId"), which, file), remove ? "imageRemoved" : "imageAdded");
  });
}

export async function deleteBannerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let done = false;
  const result = await runAdminAction(form, async (actor) => {
    if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
    const r = await deleteBanner(actor, text(form, "bannerId"));
    done = r.status === "ok";
    return state(r, "deleted");
  });
  if (done) redirect({ href: "/admin/banners?deleted=1", locale: localeOf(form) });
  return result;
}
