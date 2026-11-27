import "server-only";
import { createHash } from "node:crypto";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import { imageRenditions, releaseImage, storeImage, type UploadedFile } from "@/modules/media/service/images";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, authorizeAny, AuthzError } from "@/modules/rbac/service/authorize";
import { ArticleBody, parseArticle, type ArticleInput, type ArticleParsed } from "../domain/article";
import { bodyText, type Block } from "../domain/info-page";
import {
  articleById,
  insertArticle,
  listArticles,
  lockArticle,
  publishedArticleBySlug,
  publishedArticles,
  setArticleCoverRow,
  sitemapArticleRows,
  slugOwner,
  softDeleteArticle,
  updateArticle,
  type ArticleWrite,
} from "../repo/article-repo";

/**
 * The store's articles (article.manage). Super and Business Admins hold it
 * for everything: they write, publish, hide and delete articles and set
 * covers. Store Staff hold it per product category; articles belong to no
 * category, so staff write drafts only (an admin reviews and publishes
 * them) and can't change an article once it has been published.
 * Published articles appear on the storefront under /blog.
 */

export type ArticleResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 30;
const SHOP_PAGE = 12;

/**
 * Who may work on articles. An unscoped grant (Super and Business Admins)
 * goes through authorize() like every other check. A per-category grant
 * (Store Staff) allows drafts when it names at least one category: articles
 * have no category, so the rule is "staff with any article scope write
 * drafts" (docs/RBAC.md); a grant with no category rows is refused.
 */
async function access(actor: Actor): Promise<{ userId: string; full: boolean }> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("article.manage", "not_admin");
  const grant = actor.permissions.get("article.manage");
  if (grant?.unscoped) {
    await authorize(actor, "article.manage");
    return { userId: actor.userId, full: true };
  }
  if (!grant || grant.categoryIds.size === 0) await authorize(actor, "article.manage"); // records the denial and throws
  await authorizeAny(actor, ["article.manage"], "articles");
  return { userId: actor.userId, full: false };
}

/** Publishing, hiding, deleting and covers: the unscoped grant (recorded as a denial otherwise). */
async function allow(actor: Actor, resourceId?: string): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("article.manage", "not_admin");
  await authorize(actor, "article.manage", resourceId ? { type: "article", id: resourceId } : undefined);
  return actor.userId;
}

const isUnique = (error: unknown) => error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002";

function write(parsed: ArticleParsed, publishedAt: Date | null, now: Date): ArticleWrite {
  const langs = [["fa", parsed.fa] as const, ...(parsed.en ? [["en", parsed.en] as const] : [])];
  return {
    status: parsed.status,
    // The first publication date is kept when an article is edited or hidden and shown again.
    publishedAt: publishedAt ?? (parsed.status === "published" ? now : null),
    translations: langs.map(([locale, l]) => ({ locale, title: l.title, slug: l.slug, excerpt: l.excerpt, body: l.body, searchTitle: l.searchTitle })),
  };
}

/** A slug another article already uses, per language. */
async function slugClash(parsed: ArticleParsed, selfId: string | null): Promise<string | null> {
  for (const [locale, l] of [["fa", parsed.fa], ["en", parsed.en]] as const) {
    if (!l) continue;
    const owner = await slugOwner(db(), locale, l.slug);
    if (owner && owner !== selfId) return `${locale}_slug_taken`;
  }
  return null;
}

const bodyHash = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
/** What the audit keeps: status, titles, addresses and a fingerprint of each text, so text changes show up. */
const summary = (w: { status: string; translations: readonly { locale: string; title: string; slug: string; body: unknown }[] }) => ({
  status: w.status,
  titles: Object.fromEntries(w.translations.map((t) => [t.locale, t.title])),
  slugs: Object.fromEntries(w.translations.map((t) => [t.locale, t.slug])),
  textHashes: Object.fromEntries(w.translations.map((t) => [t.locale, bodyHash(t.body)])),
});

export async function articlesForAdmin(actor: Actor, page = 1) {
  const { full } = await access(actor);
  const current = Math.min(Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)), 10_000);
  const { rows, total } = await listArticles(db(), (current - 1) * PAGE, PAGE);
  return {
    canPublish: full,
    page: current,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
      author: r.author.name,
      fa: r.translations.find((t) => t.locale === "fa") ?? null,
      hasEnglish: r.translations.some((t) => t.locale === "en"),
    })),
  };
}

const blocksOf = (body: unknown): Block[] | undefined => {
  const parsed = ArticleBody.safeParse(body);
  return parsed.success ? parsed.data.blocks : undefined;
};

export async function articleForAdmin(actor: Actor, id: string) {
  const { full } = await access(actor);
  if (!UUID.test(id)) return null;
  const row = await articleById(db(), id);
  if (!row) return null;
  const fa = row.translations.find((t) => t.locale === "fa");
  const en = row.translations.find((t) => t.locale === "en");
  return {
    id: row.id,
    canPublish: full,
    /** Store Staff can't change an article once it has left draft. */
    canEdit: full || row.status === "draft",
    status: row.status,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    cover: row.coverMediaId ? await imageRenditions(row.coverMediaId) : [],
    faTitle: fa?.title ?? "",
    faSlug: fa?.slug ?? "",
    faExcerpt: fa?.excerpt ?? "",
    faBody: bodyText(blocksOf(fa?.body)),
    enTitle: en?.title ?? "",
    enSlug: en?.slug ?? "",
    enExcerpt: en?.excerpt ?? "",
    enBody: bodyText(blocksOf(en?.body)),
  };
}

export async function createArticle(actor: Actor, input: ArticleInput, now = new Date()): Promise<ArticleResult> {
  const { userId, full } = await access(actor);
  const parsed = parseArticle(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  if (!full && parsed.status !== "draft") await allow(actor);
  const clash = await slugClash(parsed, null);
  if (clash) return { status: "invalid", field: clash };
  const row = write(parsed, null, now);
  try {
    const id = await transaction(async (tx) => {
      const id = await insertArticle(tx, userId, row);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "article.created", entityType: "article", entityId: id, after: summary(row) });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    if (isUnique(error)) return { status: "invalid", field: "slug_taken" };
    throw error;
  }
}

export async function saveArticle(actor: Actor, id: string, input: ArticleInput, now = new Date()): Promise<ArticleResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const { userId, full } = await access(actor);
  const parsed = parseArticle(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  if (!full) {
    const current = await articleById(db(), id);
    if (!current) return { status: "not_found" };
    if (current.status !== "draft" || parsed.status !== "draft") await allow(actor, id);
  }
  const clash = await slugClash(parsed, id);
  if (clash) return { status: "invalid", field: clash };
  try {
    return await transaction(async (tx) => {
      const locked = await lockArticle(tx, id);
      if (!locked) return { status: "not_found" } as const;
      // Published by an admin while a staff member was editing the draft.
      if (!full && locked.status !== "draft") return { status: "invalid", field: "not_draft" } as const;
      const before = await articleById(tx, id);
      const row = write(parsed, locked.published_at, now);
      await updateArticle(tx, id, row);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "article.updated",
        entityType: "article",
        entityId: id,
        before: before ? summary(before) : undefined,
        after: summary(row),
      });
      return { status: "ok", id } as const;
    });
  } catch (error) {
    if (isUnique(error)) return { status: "invalid", field: "slug_taken" };
    throw error;
  }
}

/** Adds, replaces or removes the cover picture (needs media.upload to add). */
export async function setArticleCover(actor: Actor, id: string, file: UploadedFile | null): Promise<ArticleResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const userId = await allow(actor, id);
  if (!(await articleById(db(), id))) return { status: "not_found" };
  let mediaId: string | null = null;
  if (file) {
    const stored = await storeImage(actor, file, { categoryIds: [] });
    if (stored.status !== "ok") return stored;
    mediaId = stored.mediaId;
  }
  let previous: string | null;
  try {
    previous = await transaction(async (tx) => {
      const before = await setArticleCoverRow(tx, id, mediaId);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "article.cover_changed", entityType: "article", entityId: id, before: { mediaId: before }, after: { mediaId } });
      return before;
    });
  } catch (error) {
    if (mediaId) await releaseImage(mediaId);
    throw error;
  }
  if (previous && previous !== mediaId) await releaseImage(previous);
  return { status: "ok", id };
}

/** Removes an article from the store and the admin list (its row stays for the audit trail). */
export async function deleteArticle(actor: Actor, id: string, now = new Date()): Promise<ArticleResult> {
  if (!UUID.test(id)) return { status: "not_found" };
  const userId = await allow(actor, id);
  const removed = await transaction(async (tx) => {
    const before = await articleById(tx, id);
    const removed = await softDeleteArticle(tx, id, now);
    if (!removed) return null;
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "article.deleted",
      entityType: "article",
      entityId: id,
      before: before ? { status: before.status, titles: Object.fromEntries(before.translations.map((t) => [t.locale, t.title])) } : undefined,
    });
    return removed;
  });
  if (!removed) return { status: "not_found" };
  if (removed.cover) await releaseImage(removed.cover);
  return { status: "ok", id };
}

// Storefront ---------------------------------------------------------------------------------

type Translation = { locale: string; title: string; slug: string; excerpt: string | null };

/** The visitor's language when the article has it, otherwise Persian (flagged). */
function pick<T extends Translation>(translations: readonly T[], locale: "fa" | "en"): (T & { lang: "fa" | "en" }) | null {
  const own = translations.find((t) => t.locale === locale);
  const fa = translations.find((t) => t.locale === "fa");
  const chosen = own ?? fa;
  return chosen ? { ...chosen, lang: chosen.locale === "en" ? "en" : "fa" } : null;
}

export async function shopArticles(locale: "fa" | "en", page = 1, now = new Date()) {
  const current = Math.min(Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)), 1_000);
  const { rows, total } = await publishedArticles(db(), now, (current - 1) * SHOP_PAGE, SHOP_PAGE);
  const items = await Promise.all(
    rows.map(async (r) => {
      const t = pick(r.translations, locale);
      return t ? { id: r.id, title: t.title, slug: t.slug, excerpt: t.excerpt, lang: t.lang, publishedAt: r.publishedAt!, cover: r.coverMediaId ? await imageRenditions(r.coverMediaId) : [] } : null;
    }),
  );
  return { page: current, pages: Math.max(1, Math.ceil(total / SHOP_PAGE)), items: items.filter((i) => i !== null) };
}

/**
 * One published article by its address in the visitor's language. In English,
 * an article written only in Persian is found by its Persian address.
 */
export async function shopArticle(locale: "fa" | "en", slug: string, now = new Date()) {
  if (slug.length > 200) return null;
  const row = (await publishedArticleBySlug(db(), locale, slug, now)) ?? (locale === "en" ? await publishedArticleBySlug(db(), "fa", slug, now) : null);
  if (!row) return null;
  const t = pick(row.translations, locale);
  const blocks = t ? blocksOf(row.translations.find((x) => x.locale === t.locale)?.body) : undefined;
  if (!t || !blocks) return null;
  return {
    id: row.id,
    title: t.title,
    excerpt: t.excerpt,
    blocks,
    lang: t.lang,
    isFallback: locale === "en" && t.lang === "fa",
    slugs: Object.fromEntries(row.translations.map((x) => [x.locale, x.slug])) as Partial<Record<"fa" | "en", string>>,
    /** The address in the visitor's language, to send visitors who used the other one there. */
    canonicalSlug: t.slug,
    publishedAt: row.publishedAt!,
    updatedAt: row.updatedAt,
    author: row.author.name,
    cover: row.coverMediaId ? await imageRenditions(row.coverMediaId) : [],
  };
}

/** Public addresses of published articles, per language that has its own address (sitemap). */
export async function articleSitemap(limit: number, now = new Date()) {
  const rows = await sitemapArticleRows(db(), now, limit);
  return rows.flatMap((r) => r.translations.flatMap((t) => (t.locale === "fa" || t.locale === "en" ? [{ path: `/blog/${t.slug}`, locale: t.locale as "fa" | "en", updatedAt: r.updatedAt }] : [])));
}
