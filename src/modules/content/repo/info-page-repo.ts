/**
 * Database access for the information pages. The database guards the rest:
 * a revision's document never changes, published revisions are never
 * deleted, and a page's published revision must be its own.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

export type Tx = Prisma.TransactionClient;

const pageSelect = {
  id: true,
  key: true,
  status: true,
  updatedAt: true,
  translations: { select: { locale: true, title: true, slug: true } },
  publishedRevision: { select: { revisionNo: true, document: true, publishedAt: true } },
} satisfies Prisma.PageSelect;

export async function pagesByKeys(client: DbClient, keys: readonly string[]) {
  return client.page.findMany({ where: { key: { in: [...keys] }, deletedAt: null }, select: pageSelect });
}

export async function pageByKey(client: DbClient, key: string) {
  return client.page.findFirst({ where: { key, deletedAt: null }, select: pageSelect });
}

/**
 * Saves an edit as a new revision and publishes it: the page row (created
 * the first time) is locked so two saves number their revisions in turn,
 * the previous published revision becomes superseded, and the titles are
 * replaced. The URL slug of a system page is its key in every language.
 */
export async function publishRevision(
  tx: Tx,
  page: { key: string; userId: string; now: Date; titles: { fa: string; en: string | null }; document: Prisma.InputJsonValue },
): Promise<{ id: string; revisionId: string; revisionNo: number; previousRevisionNo: number | null }> {
  await tx.$executeRaw`INSERT INTO pages (key, status) VALUES (${page.key}, 'draft') ON CONFLICT (key) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: string; published_revision_id: string | null }[]>`
    SELECT id, published_revision_id FROM pages WHERE key = ${page.key} FOR UPDATE`;
  const id = row!.id;
  const last = await tx.pageRevision.aggregate({ where: { pageId: id }, _max: { revisionNo: true } });
  const revisionNo = (last._max.revisionNo ?? 0) + 1;
  let previousRevisionNo: number | null = null;
  if (row!.published_revision_id) {
    const previous = await tx.pageRevision.update({ where: { id: row!.published_revision_id }, data: { status: "superseded" }, select: { revisionNo: true } });
    previousRevisionNo = previous.revisionNo;
  }
  const revision = await tx.pageRevision.create({
    data: {
      pageId: id,
      revisionNo,
      schemaVersion: 1,
      document: page.document,
      status: "published",
      createdById: page.userId,
      publishedById: page.userId,
      publishedAt: page.now,
    },
    select: { id: true },
  });
  // A system page that was soft-deleted comes back when it is written again.
  await tx.page.update({ where: { id }, data: { status: "published", publishedRevisionId: revision.id, deletedAt: null } });
  await tx.pageTranslation.upsert({
    where: { pageId_locale: { pageId: id, locale: "fa" } },
    create: { pageId: id, locale: "fa", title: page.titles.fa, slug: page.key },
    update: { title: page.titles.fa },
  });
  if (page.titles.en) {
    await tx.pageTranslation.upsert({
      where: { pageId_locale: { pageId: id, locale: "en" } },
      create: { pageId: id, locale: "en", title: page.titles.en, slug: page.key },
      update: { title: page.titles.en },
    });
  } else {
    await tx.pageTranslation.deleteMany({ where: { pageId: id, locale: "en" } });
  }
  return { id, revisionId: revision.id, revisionNo, previousRevisionNo };
}
