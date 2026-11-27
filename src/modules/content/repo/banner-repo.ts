/** Database access for banners. The database checks the link shape and the date window. */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

const bannerSelect = {
  id: true,
  placement: true,
  desktopMediaId: true,
  mobileMediaId: true,
  href: true,
  sortOrder: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  updatedAt: true,
  translations: { select: { locale: true, title: true, subtitle: true, ctaLabel: true, alt: true } },
} satisfies Prisma.BannerSelect;

export async function listBanners(client: DbClient) {
  return client.banner.findMany({ orderBy: [{ placement: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }], select: bannerSelect, take: 200 });
}

export async function bannerById(client: DbClient, id: string) {
  return client.banner.findUnique({ where: { id }, select: bannerSelect });
}

export type BannerWrite = {
  href: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  translations: { locale: "fa" | "en"; title: string; subtitle: string | null; ctaLabel: string | null; alt: string }[];
};

export async function insertBanner(tx: Tx, placement: string, desktopMediaId: string, row: BannerWrite): Promise<string> {
  const { translations, ...rest } = row;
  const created = await tx.banner.create({ data: { ...rest, placement, desktopMediaId }, select: { id: true } });
  await tx.bannerTranslation.createMany({ data: translations.map((t) => ({ ...t, bannerId: created.id })) });
  return created.id;
}

export async function lockBanner(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ desktop_media_id: string; mobile_media_id: string | null }[]>`
    SELECT desktop_media_id, mobile_media_id FROM banners WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function updateBanner(tx: Tx, id: string, row: BannerWrite): Promise<void> {
  const { translations, ...rest } = row;
  await tx.banner.update({ where: { id }, data: rest });
  await tx.bannerTranslation.deleteMany({ where: { bannerId: id, locale: { notIn: translations.map((t) => t.locale) } } });
  for (const t of translations) {
    await tx.bannerTranslation.upsert({ where: { bannerId_locale: { bannerId: id, locale: t.locale } }, create: { ...t, bannerId: id }, update: t });
  }
}

export async function setBannerImageRow(tx: Tx, id: string, which: "desktop" | "mobile", mediaId: string | null): Promise<string | null> {
  const locked = await lockBanner(tx, id);
  if (!locked) throw new Error("banner not found");
  if (which === "desktop") {
    if (!mediaId) throw new Error("a banner needs a wide-screen picture");
    await tx.banner.update({ where: { id }, data: { desktopMediaId: mediaId } });
    return locked.desktop_media_id;
  }
  await tx.banner.update({ where: { id }, data: { mobileMediaId: mediaId } });
  return locked.mobile_media_id;
}

/** Deletes a banner; returns its pictures so they can be released. */
export async function deleteBannerRow(tx: Tx, id: string): Promise<string[] | null> {
  const locked = await lockBanner(tx, id);
  if (!locked) return null;
  await tx.banner.delete({ where: { id } });
  return [locked.desktop_media_id, locked.mobile_media_id].filter((m): m is string => Boolean(m));
}

/** Banners showing now in a placement, in order. */
export async function liveBanners(client: DbClient, placement: string, now: Date, take: number) {
  return client.banner.findMany({
    where: { placement, isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
    // Lower order numbers first; among equals, the newest banner first.
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take,
    select: bannerSelect,
  });
}
