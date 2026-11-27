import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { ALL_VISIBLE, DEFAULT_HOME, defaultProps, isSectionType, readDocument, SECTION_PROPS, type BuilderDocument, type BuilderSection, type SectionType, type Visibility } from "../domain/registry";
import { builderPage, currentDraft, discardDrafts, lockBuilderPage, publishedDocument, publishedRevisions, publishRevision, revisionOf, saveDraftRevision } from "../repo/builder-repo";

/**
 * The page builder for the home page (Super Admin: pagebuilder.edit to edit
 * the draft and preview it, pagebuilder.publish to publish or bring back an
 * earlier version). Every edit validates the whole document against the
 * registry and saves it as the page's single draft; publishing makes the
 * draft a new published revision and keeps the old ones for rollback.
 * Edits carry the draft they started from, so two editors can't silently
 * overwrite each other.
 */

export const HOME = "home";
export type BuilderResult = { status: "ok" } | { status: "stale" } | { status: "not_found" } | { status: "invalid"; field: string };

export type BuilderEdit =
  | { kind: "add"; type: string }
  | { kind: "move"; id: string; direction: "up" | "down" }
  | { kind: "remove"; id: string }
  | { kind: "update"; id: string; props: unknown; visibility: Visibility };

async function allow(actor: Actor, permission: "pagebuilder.edit" | "pagebuilder.publish"): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(permission, "not_admin");
  await authorize(actor, permission);
  return actor.userId;
}

const sha256 = (doc: unknown) => createHash("sha256").update(JSON.stringify(doc)).digest("hex");
const newId = () => randomBytes(6).toString("hex").slice(0, 10);
/**
 * The state an editor's form was built from: the draft, or (with no draft)
 * the published revision. It changes on every save, publish, restore and
 * discard, so a form built from an older state is refused as stale.
 */
const baseOf = (draftId: string | null | undefined, publishedId: string | null | undefined) => (draftId ? `d:${draftId}` : `p:${publishedId ?? "none"}`);

export async function builderForAdmin(actor: Actor) {
  await allow(actor, "pagebuilder.edit");
  const page = await builderPage(db(), HOME);
  const draftDoc = page?.draft ? readDocument(page.draft.document) : null;
  const publishedDoc = page?.publishedRevision ? readDocument(page.publishedRevision.document) : null;
  const document = draftDoc ?? publishedDoc ?? DEFAULT_HOME;
  return {
    canPublish: actor.permissions.has("pagebuilder.publish"),
    base: baseOf(page?.draft?.id, page?.publishedRevision?.id),
    source: draftDoc ? ("draft" as const) : publishedDoc ? ("published" as const) : ("default" as const),
    document,
    draft: page?.draft ? { revisionNo: page.draft.revisionNo, at: page.draft.createdAt, by: page.draft.createdBy.name } : null,
    published: page?.publishedRevision ? { revisionNo: page.publishedRevision.revisionNo, at: page.publishedRevision.publishedAt, by: page.publishedRevision.publishedBy?.name ?? null } : null,
    history: page ? (await publishedRevisions(db(), page.id, 20)).map((r) => ({ id: r.id, revisionNo: r.revisionNo, status: r.status, at: r.publishedAt, by: r.publishedBy?.name ?? null, note: r.note, restoredFrom: r.restoredFrom, sections: readDocument(r.document)?.sections.length ?? 0 })) : [],
  };
}

function apply(doc: BuilderDocument, edit: BuilderEdit): BuilderDocument | { field: string } {
  const sections = [...doc.sections];
  const at = "id" in edit ? sections.findIndex((s) => s.id === edit.id) : -1;
  switch (edit.kind) {
    case "add": {
      if (!isSectionType(edit.type)) return { field: "invalid" };
      const type: SectionType = edit.type;
      sections.push({ id: newId(), type, visibility: ALL_VISIBLE, props: defaultProps(type) } as BuilderSection);
      break;
    }
    case "move": {
      const to = edit.direction === "up" ? at - 1 : at + 1;
      if (at < 0) return { field: "section_missing" };
      if (to < 0 || to >= sections.length) return doc;
      [sections[at], sections[to]] = [sections[to]!, sections[at]!];
      break;
    }
    case "remove":
      if (at < 0) return { field: "section_missing" };
      sections.splice(at, 1);
      break;
    case "update": {
      if (at < 0) return { field: "section_missing" };
      const current = sections[at]!;
      const props = SECTION_PROPS[current.type].safeParse(edit.props);
      if (!props.success) return { field: "invalid" };
      sections[at] = { ...current, props: props.data, visibility: edit.visibility } as BuilderSection;
      break;
    }
  }
  const next = readDocument({ version: 1, sections });
  return next ?? { field: sections.length > doc.sections.length ? "too_many_sections" : "invalid" };
}

/** One edit to the draft (created from the published page, or the default one, when there is none). */
export async function editHome(actor: Actor, base: string, edit: BuilderEdit): Promise<BuilderResult> {
  const userId = await allow(actor, "pagebuilder.edit");
  return transaction(async (tx) => {
    const page = await lockBuilderPage(tx, HOME);
    const draft = await currentDraft(tx, page.id);
    if (baseOf(draft?.id, page.publishedRevisionId) !== base) return { status: "stale" } as const;
    const published = page.publishedRevisionId ? await revisionOf(tx, page.id, page.publishedRevisionId) : null;
    const current = (draft ? readDocument(draft.document) : null) ?? (published ? readDocument(published.document) : null) ?? DEFAULT_HOME;
    const next = apply(current, edit);
    if ("field" in next) return { status: "invalid", field: next.field } as const;
    const id = await saveDraftRevision(tx, page.id, userId, next);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "pagebuilder.draft_saved",
      entityType: "page_revision",
      entityId: id,
      before: { page: HOME, draft: draft?.id ?? null, sections: current.sections.map((s) => s.type) },
      after: { page: HOME, edit: edit.kind, type: edit.kind === "add" ? edit.type : undefined, section: "id" in edit ? edit.id : undefined, props: edit.kind === "update" ? edit.props : undefined, sections: next.sections.map((s) => s.type), documentSha256: sha256(next) },
    });
    return { status: "ok" } as const;
  });
}

export async function discardHomeDraft(actor: Actor, base: string): Promise<BuilderResult> {
  const userId = await allow(actor, "pagebuilder.edit");
  return transaction(async (tx) => {
    const page = await lockBuilderPage(tx, HOME);
    const draft = await currentDraft(tx, page.id);
    if (baseOf(draft?.id, page.publishedRevisionId) !== base) return { status: "stale" } as const;
    const count = await discardDrafts(tx, page.id);
    if (count > 0) await recordAudit(tx, actor.meta, { actorUserId: userId, action: "pagebuilder.draft_discarded", entityType: "page", entityId: page.id, after: { page: HOME } });
    return { status: "ok" } as const;
  });
}

/** Publishes the draft the editor was looking at. */
export async function publishHome(actor: Actor, base: string, noteInput: string, now = new Date()): Promise<BuilderResult> {
  const userId = await allow(actor, "pagebuilder.publish");
  const note = noteInput.trim().slice(0, 500) || null;
  return transaction(async (tx) => {
    const page = await lockBuilderPage(tx, HOME);
    const draft = await currentDraft(tx, page.id);
    if (!draft) return { status: "invalid", field: "nothing_to_publish" } as const;
    if (baseOf(draft.id, page.publishedRevisionId) !== base) return { status: "stale" } as const;
    const document = readDocument(draft.document);
    if (!document) return { status: "invalid", field: "invalid" } as const;
    const revision = await publishRevision(tx, page, userId, now, document, note);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "pagebuilder.published", entityType: "page_revision", entityId: revision.id, before: { page: HOME, published: page.publishedRevisionId }, after: { page: HOME, revisionNo: revision.revisionNo, note, sections: document.sections.map((s) => s.type) } });
    return { status: "ok" } as const;
  });
}

/** Publishes an earlier version again, as a new revision (history is never rewritten). */
export async function restoreHomeRevision(actor: Actor, base: string, revisionId: string, now = new Date()): Promise<BuilderResult> {
  const userId = await allow(actor, "pagebuilder.publish");
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) return { status: "not_found" };
  return transaction(async (tx) => {
    const page = await lockBuilderPage(tx, HOME);
    const draft = await currentDraft(tx, page.id);
    if (baseOf(draft?.id, page.publishedRevisionId) !== base) return { status: "stale" } as const;
    const old = await revisionOf(tx, page.id, revisionId);
    if (!old || old.status === "draft") return { status: "not_found" } as const;
    const document = readDocument(old.document);
    if (!document) return { status: "invalid", field: "invalid" } as const;
    const revision = await publishRevision(tx, page, userId, now, document, null, old.revisionNo);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "pagebuilder.restored", entityType: "page_revision", entityId: revision.id, before: { page: HOME, published: page.publishedRevisionId }, after: { page: HOME, from: old.revisionNo, revisionNo: revision.revisionNo } });
    return { status: "ok" } as const;
  });
}

/** The draft (or what would be shown) for the preview page; editors only. */
export async function previewHomeDocument(actor: Actor): Promise<BuilderDocument> {
  await allow(actor, "pagebuilder.edit");
  const page = await builderPage(db(), HOME);
  return (page?.draft ? readDocument(page.draft.document) : null) ?? (page?.publishedRevision ? readDocument(page.publishedRevision.document) : null) ?? DEFAULT_HOME;
}

/** The home page's published document, or the default layout. */
export async function shopHomeDocument(): Promise<BuilderDocument> {
  return readDocument(await publishedDocument(db(), HOME)) ?? DEFAULT_HOME;
}
