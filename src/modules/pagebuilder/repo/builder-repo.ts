/**
 * Database access for builder pages (today the home page, key "home").
 * The database guards revisions: a revision's document never changes,
 * published revisions are never deleted, and a page's published revision
 * must be its own. Drafts are revisions too; only the newest is kept.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

const revisionSelect = {
  id: true,
  revisionNo: true,
  document: true,
  status: true,
  note: true,
  restoredFrom: true,
  createdAt: true,
  publishedAt: true,
  createdBy: { select: { name: true } },
  publishedBy: { select: { name: true } },
} satisfies Prisma.PageRevisionSelect;

export async function builderPage(client: DbClient, key: string) {
  const page = await client.page.findFirst({ where: { key, deletedAt: null }, select: { id: true, status: true, publishedRevision: { select: revisionSelect } } });
  if (!page) return null;
  const draft = await client.pageRevision.findFirst({ where: { pageId: page.id, status: "draft" }, orderBy: { revisionNo: "desc" }, select: revisionSelect });
  return { ...page, draft };
}

/** The published document of a page (storefront). */
export async function publishedDocument(client: DbClient, key: string) {
  const page = await client.page.findFirst({ where: { key, deletedAt: null, status: "published" }, select: { publishedRevision: { select: { document: true } } } });
  return page?.publishedRevision?.document ?? null;
}

/** Creates the page row the first time and locks it, so edits and publications run one at a time. */
export async function lockBuilderPage(tx: Tx, key: string): Promise<{ id: string; publishedRevisionId: string | null }> {
  await tx.$executeRaw`INSERT INTO pages (key, status) VALUES (${key}, 'draft') ON CONFLICT (key) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: string; published_revision_id: string | null }[]>`SELECT id, published_revision_id FROM pages WHERE key = ${key} FOR UPDATE`;
  return { id: row!.id, publishedRevisionId: row!.published_revision_id };
}

export async function currentDraft(tx: Tx, pageId: string) {
  return tx.pageRevision.findFirst({ where: { pageId, status: "draft" }, orderBy: { revisionNo: "desc" }, select: { id: true, document: true } });
}

async function nextRevisionNo(tx: Tx, pageId: string): Promise<number> {
  const last = await tx.pageRevision.aggregate({ where: { pageId }, _max: { revisionNo: true } });
  return (last._max.revisionNo ?? 0) + 1;
}

/** Replaces the page's draft with a new one (older drafts are deleted). */
export async function saveDraftRevision(tx: Tx, pageId: string, userId: string, document: Prisma.InputJsonValue): Promise<string> {
  await tx.pageRevision.deleteMany({ where: { pageId, status: "draft" } });
  const created = await tx.pageRevision.create({
    data: { pageId, revisionNo: await nextRevisionNo(tx, pageId), schemaVersion: 1, document, status: "draft", createdById: userId },
    select: { id: true },
  });
  return created.id;
}

export async function discardDrafts(tx: Tx, pageId: string): Promise<number> {
  return (await tx.pageRevision.deleteMany({ where: { pageId, status: "draft" } })).count;
}

/** Publishes a document as a new revision: the previous one is superseded and drafts are dropped. */
export async function publishRevision(tx: Tx, page: { id: string; publishedRevisionId: string | null }, userId: string, now: Date, document: Prisma.InputJsonValue, note: string | null, restoredFrom: number | null = null) {
  if (page.publishedRevisionId) await tx.pageRevision.update({ where: { id: page.publishedRevisionId }, data: { status: "superseded" } });
  await tx.pageRevision.deleteMany({ where: { pageId: page.id, status: "draft" } });
  const revision = await tx.pageRevision.create({
    data: { pageId: page.id, revisionNo: await nextRevisionNo(tx, page.id), schemaVersion: 1, document, status: "published", note, restoredFrom, createdById: userId, publishedById: userId, publishedAt: now },
    select: { id: true, revisionNo: true },
  });
  await tx.page.update({ where: { id: page.id }, data: { status: "published", publishedRevisionId: revision.id } });
  return revision;
}

/** Published and earlier published revisions, newest first. */
export async function publishedRevisions(client: DbClient, pageId: string, take: number) {
  return client.pageRevision.findMany({ where: { pageId, status: { in: ["published", "superseded"] } }, orderBy: { revisionNo: "desc" }, take, select: revisionSelect });
}

export async function revisionOf(client: DbClient, pageId: string, revisionId: string) {
  return client.pageRevision.findFirst({ where: { id: revisionId, pageId }, select: { id: true, revisionNo: true, document: true, status: true } });
}
