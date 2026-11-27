import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { bodyText, INFO_PAGE_KEYS, InfoPageDocument, isInfoPageKey, parseInfoPage, type Block, type InfoPageInput, type InfoPageKey } from "../domain/info-page";
import { pageByKey, pagesByKeys, publishRevision } from "../repo/info-page-repo";

/**
 * The store's information pages (content.manage). Each save is a new,
 * published revision; older revisions are kept. The storefront shows a page
 * once it has been written, and only its published revision.
 */

export type InfoPageResult = { status: "ok"; revisionNo: number } | { status: "not_found" } | { status: "invalid"; field: string };

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("content.manage", "not_admin");
  await authorize(actor, "content.manage");
  return actor.userId;
}

type Row = NonNullable<Awaited<ReturnType<typeof pageByKey>>>;

/** The published document, or null when it is missing or doesn't match the schema (never rendered then). */
function contentOf(row: Row | null | undefined): { fa: Block[]; en?: Block[] } | null {
  const parsed = InfoPageDocument.safeParse(row?.publishedRevision?.document);
  return parsed.success ? (parsed.data.sections[0]?.props.content ?? null) : null;
}

const titleOf = (row: Row | undefined, locale: "fa" | "en") => row?.translations.find((t) => t.locale === locale)?.title ?? null;

export async function infoPagesForAdmin(actor: Actor) {
  await allow(actor);
  const rows = new Map((await pagesByKeys(db(), INFO_PAGE_KEYS)).map((r) => [r.key, r]));
  return INFO_PAGE_KEYS.map((key) => {
    const row = rows.get(key);
    return {
      key,
      published: row?.status === "published" && contentOf(row) !== null,
      hasEnglish: Boolean(titleOf(row, "en")),
      revisionNo: row?.publishedRevision?.revisionNo ?? null,
      publishedAt: row?.publishedRevision?.publishedAt ?? null,
    };
  });
}

export async function infoPageForAdmin(actor: Actor, key: string) {
  await allow(actor);
  if (!isInfoPageKey(key)) return null;
  const row = await pageByKey(db(), key);
  const content = contentOf(row);
  return {
    key,
    faTitle: titleOf(row ?? undefined, "fa") ?? "",
    enTitle: titleOf(row ?? undefined, "en") ?? "",
    faBody: bodyText(content?.fa),
    enBody: bodyText(content?.en),
    revisionNo: row?.publishedRevision?.revisionNo ?? null,
    publishedAt: row?.publishedRevision?.publishedAt ?? null,
  };
}

export async function saveInfoPage(actor: Actor, key: string, input: InfoPageInput, now = new Date()): Promise<InfoPageResult> {
  const userId = await allow(actor);
  if (!isInfoPageKey(key)) return { status: "not_found" };
  const parsed = parseInfoPage(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  const saved = await transaction(async (tx) => {
    const revision = await publishRevision(tx, { key, userId, now, titles: parsed.titles, document: parsed.document });
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "content.page_published",
      entityType: "page",
      entityId: revision.id,
      before: revision.previousRevisionNo === null ? undefined : { key, revisionNo: revision.previousRevisionNo },
      after: { key, revisionId: revision.revisionId, revisionNo: revision.revisionNo, titles: parsed.titles },
    });
    return revision;
  });
  return { status: "ok", revisionNo: saved.revisionNo };
}

/** A published page for the storefront. English falls back to the Persian text, flagged so the page can say so. */
export async function shopInfoPage(locale: "fa" | "en", key: string) {
  if (!isInfoPageKey(key)) return null;
  const row = await pageByKey(db(), key);
  if (!row || row.status !== "published") return null;
  const content = contentOf(row);
  if (!content) return null;
  const english = locale === "en" && content.en && titleOf(row, "en");
  return english
    ? { key: key as InfoPageKey, title: titleOf(row, "en")!, blocks: content.en!, lang: "en" as const, isFallback: false, hasEnglish: true }
    : { key: key as InfoPageKey, title: titleOf(row, "fa")!, blocks: content.fa, lang: "fa" as const, isFallback: locale === "en", hasEnglish: Boolean(content.en) };
}

/** Footer links: the written pages, in the fixed order, titled in the visitor's language when there is one. */
export async function shopInfoPageLinks(locale: "fa" | "en") {
  const rows = new Map((await pagesByKeys(db(), INFO_PAGE_KEYS)).map((r) => [r.key, r]));
  return INFO_PAGE_KEYS.flatMap((key) => {
    const row = rows.get(key);
    if (!row || row.status !== "published" || !row.publishedRevision) return [];
    const en = locale === "en" ? titleOf(row, "en") : null;
    const title = en ?? titleOf(row, "fa");
    return title ? [{ key, title, lang: en ? ("en" as const) : ("fa" as const) }] : [];
  });
}
