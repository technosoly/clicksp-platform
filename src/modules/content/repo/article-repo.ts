/**
 * Database access for articles. Slugs are unique per language (index) and
 * must match the slug pattern (check constraint); a published article has
 * a publication date (check constraint).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

const translationSelect = { locale: true, title: true, slug: true, excerpt: true, body: true } satisfies Prisma.ArticleTranslationSelect;

export async function listArticles(client: DbClient, skip: number, take: number) {
  const where = { deletedAt: null } satisfies Prisma.ArticleWhereInput;
  const [rows, total] = await Promise.all([
    client.article.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: { id: true, status: true, publishedAt: true, updatedAt: true, translations: { select: { locale: true, title: true, slug: true } }, author: { select: { name: true } } },
    }),
    client.article.count({ where }),
  ]);
  return { rows, total };
}

export async function articleById(client: DbClient, id: string) {
  return client.article.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, publishedAt: true, updatedAt: true, coverMediaId: true, translations: { select: translationSelect } },
  });
}

export type ArticleWrite = {
  status: "draft" | "published" | "archived";
  publishedAt: Date | null;
  translations: { locale: "fa" | "en"; title: string; slug: string; excerpt: string | null; body: Prisma.InputJsonValue; searchTitle: string }[];
};

export async function insertArticle(tx: Tx, authorId: string, row: ArticleWrite): Promise<string> {
  const created = await tx.article.create({ data: { status: row.status, publishedAt: row.publishedAt, authorId }, select: { id: true } });
  await tx.articleTranslation.createMany({ data: row.translations.map((t) => ({ ...t, articleId: created.id })) });
  return created.id;
}

/** Locks the article row (FOR UPDATE) and returns what the audit needs. */
export async function lockArticle(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: string; published_at: Date | null; cover_media_id: string | null }[]>`
    SELECT status::text, published_at, cover_media_id FROM articles WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function updateArticle(tx: Tx, id: string, row: ArticleWrite): Promise<void> {
  await tx.article.update({ where: { id }, data: { status: row.status, publishedAt: row.publishedAt } });
  await tx.articleTranslation.deleteMany({ where: { articleId: id, locale: { notIn: row.translations.map((t) => t.locale) } } });
  for (const t of row.translations) {
    await tx.articleTranslation.upsert({ where: { articleId_locale: { articleId: id, locale: t.locale } }, create: { ...t, articleId: id }, update: t });
  }
}

export async function setArticleCoverRow(tx: Tx, id: string, mediaId: string | null): Promise<string | null> {
  const locked = await lockArticle(tx, id);
  if (!locked) throw new Error("article not found");
  await tx.article.update({ where: { id }, data: { coverMediaId: mediaId } });
  return locked.cover_media_id;
}

/** Deleted articles keep their row (and audit trail) but lose their addresses, so a new article can reuse them. */
export async function softDeleteArticle(tx: Tx, id: string, now: Date): Promise<{ cover: string | null } | null> {
  const locked = await lockArticle(tx, id);
  if (!locked) return null;
  await tx.articleTranslation.deleteMany({ where: { articleId: id } });
  await tx.article.update({ where: { id }, data: { deletedAt: now, status: "archived", coverMediaId: null } });
  return { cover: locked.cover_media_id };
}

// Storefront -----------------------------------------------------------------------------

const published = (now: Date) => ({ status: "published" as const, deletedAt: null, publishedAt: { lte: now } });

export async function publishedArticles(client: DbClient, now: Date, skip: number, take: number) {
  const where = published(now);
  const [rows, total] = await Promise.all([
    client.article.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: { id: true, publishedAt: true, coverMediaId: true, translations: { select: { locale: true, title: true, slug: true, excerpt: true } } },
    }),
    client.article.count({ where }),
  ]);
  return { rows, total };
}

export async function publishedArticleBySlug(client: DbClient, locale: "fa" | "en", slug: string, now: Date) {
  return client.article.findFirst({
    where: { ...published(now), translations: { some: { locale, slug } } },
    select: { id: true, publishedAt: true, updatedAt: true, coverMediaId: true, author: { select: { name: true } }, translations: { select: translationSelect } },
  });
}

/** The article that uses an address in a language, if any. */
export async function slugOwner(client: DbClient, locale: "fa" | "en", slug: string): Promise<string | null> {
  return (await client.articleTranslation.findUnique({ where: { locale_slug: { locale, slug } }, select: { articleId: true } }))?.articleId ?? null;
}

/** Addresses of published articles (sitemap, bounded). */
export async function sitemapArticleRows(client: DbClient, now: Date, take: number) {
  return client.article.findMany({
    where: published(now),
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take,
    select: { updatedAt: true, translations: { select: { locale: true, slug: true } } },
  });
}
