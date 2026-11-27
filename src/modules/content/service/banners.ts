import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import { imageRenditions, releaseImage, storeImage, type UploadedFile } from "@/modules/media/service/images";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { BANNER_PLACEMENTS, bannerLive, parseBanner, type BannerParsed, type BannerTextInput } from "../domain/banner";
import { parseHref } from "../domain/links";
import { bannerById, deleteBannerRow, insertBanner, listBanners, liveBanners, lockBanner, setBannerImageRow, updateBanner, type BannerWrite } from "../repo/banner-repo";

/**
 * Promotional banners on the home page (banner.manage: Super and Business
 * Admins). A banner needs a wide-screen picture; a phone picture is
 * optional. Deleting a banner deletes its pictures once nothing else uses them.
 */

export type BannerResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allow(actor: Actor, id?: string): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("banner.manage", "not_admin");
  await authorize(actor, "banner.manage", id ? { type: "banner", id } : undefined);
  return actor.userId;
}

function write(parsed: BannerParsed): BannerWrite {
  return {
    href: parsed.href,
    sortOrder: parsed.sortOrder,
    isActive: parsed.isActive,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    translations: [{ locale: "fa" as const, ...parsed.fa }, ...(parsed.en ? [{ locale: "en" as const, ...parsed.en }] : [])],
  };
}

const auditOf = (w: BannerWrite) => ({ href: w.href, sortOrder: w.sortOrder, isActive: w.isActive, startsAt: w.startsAt, endsAt: w.endsAt, titles: Object.fromEntries(w.translations.map((t) => [t.locale, t.title])) });

export async function bannersForAdmin(actor: Actor, now = new Date()) {
  await allow(actor);
  const rows = await listBanners(db());
  return Promise.all(
    rows.map(async (b) => ({
      id: b.id,
      placement: b.placement,
      title: b.translations.find((t) => t.locale === "fa")?.title ?? "",
      hasEnglish: b.translations.some((t) => t.locale === "en"),
      live: bannerLive(b, now),
      isActive: b.isActive,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      sortOrder: b.sortOrder,
      desktop: await imageRenditions(b.desktopMediaId),
    })),
  );
}

export async function bannerForAdmin(actor: Actor, id: string) {
  await allow(actor, UUID.test(id) ? id : undefined);
  if (!UUID.test(id)) return null;
  const b = await bannerById(db(), id);
  if (!b) return null;
  const fa = b.translations.find((t) => t.locale === "fa");
  const en = b.translations.find((t) => t.locale === "en");
  return {
    id: b.id,
    placement: b.placement,
    href: b.href ?? "",
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    fa: { title: fa?.title ?? "", subtitle: fa?.subtitle ?? "", cta: fa?.ctaLabel ?? "", alt: fa?.alt ?? "" },
    en: { title: en?.title ?? "", subtitle: en?.subtitle ?? "", cta: en?.ctaLabel ?? "", alt: en?.alt ?? "" },
    desktop: await imageRenditions(b.desktopMediaId),
    mobile: b.mobileMediaId ? await imageRenditions(b.mobileMediaId) : [],
  };
}

/** Creates a banner with its wide-screen picture (uploading needs media.upload too). */
export async function createBanner(actor: Actor, placement: string, input: BannerTextInput, file: UploadedFile | null): Promise<BannerResult> {
  const userId = await allow(actor);
  if (!(BANNER_PLACEMENTS as readonly string[]).includes(placement)) return { status: "invalid", field: "invalid" };
  const parsed = parseBanner(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  if (!file) return { status: "invalid", field: "image_missing" };
  const stored = await storeImage(actor, file, { categoryIds: [] });
  if (stored.status !== "ok") return stored;
  const row = write(parsed);
  try {
    const id = await transaction(async (tx) => {
      const id = await insertBanner(tx, placement, stored.mediaId, row);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "banner.created", entityType: "banner", entityId: id, after: { placement, ...auditOf(row), desktopMediaId: stored.mediaId } });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    await releaseImage(stored.mediaId);
    throw error;
  }
}

export async function saveBanner(actor: Actor, id: string, input: BannerTextInput): Promise<BannerResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const userId = await allow(actor, id);
  const parsed = parseBanner(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  const row = write(parsed);
  return transaction(async (tx) => {
    if (!(await lockBanner(tx, id))) return { status: "not_found" } as const;
    const before = await bannerById(tx, id);
    await updateBanner(tx, id, row);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "banner.updated",
      entityType: "banner",
      entityId: id,
      before: before ? { href: before.href, sortOrder: before.sortOrder, isActive: before.isActive, startsAt: before.startsAt, endsAt: before.endsAt, titles: Object.fromEntries(before.translations.map((t) => [t.locale, t.title])) } : undefined,
      after: auditOf(row),
    });
    return { status: "ok", id } as const;
  });
}

/** Replaces the wide-screen picture, or adds, replaces or removes the phone picture. */
export async function setBannerImage(actor: Actor, id: string, which: "desktop" | "mobile", file: UploadedFile | null): Promise<BannerResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const userId = await allow(actor, id);
  if (which === "desktop" && !file) return { status: "invalid", field: "image_missing" };
  if (!(await bannerById(db(), id))) return { status: "not_found" };
  let mediaId: string | null = null;
  if (file) {
    const stored = await storeImage(actor, file, { categoryIds: [] });
    if (stored.status !== "ok") return stored;
    mediaId = stored.mediaId;
  }
  let previous: string | null;
  try {
    previous = await transaction(async (tx) => {
      const before = await setBannerImageRow(tx, id, which, mediaId);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "banner.image_changed", entityType: "banner", entityId: id, before: { which, mediaId: before }, after: { which, mediaId } });
      return before;
    });
  } catch (error) {
    if (mediaId) await releaseImage(mediaId);
    throw error;
  }
  if (previous && previous !== mediaId) await releaseImage(previous);
  return { status: "ok", id };
}

export async function deleteBanner(actor: Actor, id: string): Promise<BannerResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const userId = await allow(actor, id);
  const freed = await transaction(async (tx) => {
    const before = await bannerById(tx, id);
    const freed = await deleteBannerRow(tx, id);
    if (!freed) return null;
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "banner.deleted", entityType: "banner", entityId: id, before: before ? { placement: before.placement, href: before.href, titles: Object.fromEntries(before.translations.map((t) => [t.locale, t.title])) } : undefined });
    return freed;
  });
  if (!freed) return { status: "not_found" };
  for (const mediaId of freed) await releaseImage(mediaId);
  return { status: "ok", id };
}

/** Banners showing now on the home page, in the visitor's language when given. */
export async function shopBanners(locale: "fa" | "en", now = new Date()) {
  const rows = await liveBanners(db(), "home_hero", now, 6);
  return Promise.all(
    rows.map(async (b) => {
      const own = locale === "en" ? b.translations.find((t) => t.locale === "en") : undefined;
      const t = own ?? b.translations.find((x) => x.locale === "fa");
      const href = b.href ? parseHref(b.href) : null;
      return {
        id: b.id,
        title: t?.title ?? "",
        subtitle: t?.subtitle ?? null,
        ctaLabel: href ? (t?.ctaLabel ?? null) : null,
        alt: t?.alt ?? "",
        lang: own ? ("en" as const) : ("fa" as const),
        href,
        desktop: await imageRenditions(b.desktopMediaId),
        mobile: b.mobileMediaId ? await imageRenditions(b.mobileMediaId) : [],
      };
    }),
  );
}
