/**
 * The home page builder through the real services on PostgreSQL: drafts,
 * stale edits, publishing, rollback, the database's revision guards, and
 * denial for every admin level below the Super Admin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { DEFAULT_HOME } from "@/modules/pagebuilder/domain/registry";
import { builderForAdmin, discardHomeDraft, editHome, previewHomeDocument, publishHome, restoreHomeRevision, shopHomeDocument } from "@/modules/pagebuilder/service/builder";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";

afterAll(async () => {
  await prisma().$disconnect();
});

type Admin = Awaited<ReturnType<typeof actorFor>>;
let sa: Admin;
const base = async () => (await builderForAdmin(sa)).base;
const homeId = async () => (await q<{ id: string }>("SELECT id FROM pages WHERE key = 'home'"))[0]!.id;

beforeAll(async () => {
  sa = await actorFor("super_admin");
  // Start from a page with no draft.
  await discardHomeDraft(sa, await base());
});

describe("home page builder", () => {
  it("edits a draft, refuses stale edits, publishes and rolls back", async () => {
    const before = await shopHomeDocument();
    const start = await builderForAdmin(sa);
    expect(start.base).toMatch(/^p:/);

    expect(await editHome(sa, start.base, { kind: "add", type: "callout" })).toEqual({ status: "ok" });
    const afterAdd = await builderForAdmin(sa);
    expect(afterAdd.source).toBe("draft");
    const added = afterAdd.document.sections.at(-1)!;
    expect(added.type).toBe("callout");
    // The storefront still shows what was published before.
    expect(await shopHomeDocument()).toEqual(before);
    expect((await previewHomeDocument(sa)).sections.at(-1)!.id).toBe(added.id);

    // An edit based on the old state is refused.
    expect(await editHome(sa, start.base, { kind: "remove", id: added.id })).toEqual({ status: "stale" });

    const props = { title: { fa: "TEST پیشنهاد ویژه", en: "TEST offer" }, text: {}, cta: { fa: "ببینید" }, href: "/c/test", tone: "charcoal" };
    expect(await editHome(sa, afterAdd.base, { kind: "update", id: added.id, props, visibility: { breakpoints: ["desktop"], locales: ["fa"] } })).toEqual({ status: "ok" });
    expect(await editHome(sa, await base(), { kind: "update", id: added.id, props: { ...props, href: "javascript:alert(1)" }, visibility: { breakpoints: ["desktop"], locales: ["fa"] } })).toEqual({ status: "invalid", field: "invalid" });
    // Bidi overrides are refused even when the form reader is skipped.
    expect(await editHome(sa, await base(), { kind: "update", id: added.id, props: { ...props, title: { fa: "TEST \u202Eevil" } }, visibility: { breakpoints: ["desktop"], locales: ["fa"] } })).toEqual({ status: "invalid", field: "invalid" });
    expect(await editHome(sa, await base(), { kind: "add", type: "html" })).toEqual({ status: "invalid", field: "invalid" });
    expect(await editHome(sa, await base(), { kind: "move", id: added.id, direction: "up" })).toEqual({ status: "ok" });
    // Only one draft is kept.
    const pageId = await homeId();
    expect(await q("SELECT 1 FROM page_revisions WHERE page_id = $1 AND status = 'draft'", [pageId])).toHaveLength(1);

    const draft = await builderForAdmin(sa);
    expect(await publishHome(sa, "d:stale", "x")).toEqual({ status: "stale" });
    expect(await publishHome(sa, draft.base, "TEST first")).toEqual({ status: "ok" });
    const live = await shopHomeDocument();
    expect(live).toEqual(draft.document);
    expect(live.sections.at(-2)).toMatchObject({ id: added.id, props: { href: "/c/test" }, visibility: { breakpoints: ["desktop"], locales: ["fa"] } });
    expect(await publishHome(sa, await base(), "")).toEqual({ status: "invalid", field: "nothing_to_publish" });

    // A second publication, then bring back the first.
    expect(await editHome(sa, await base(), { kind: "remove", id: added.id })).toEqual({ status: "ok" });
    expect(await publishHome(sa, await base(), "")).toEqual({ status: "ok" });
    expect((await shopHomeDocument()).sections.some((s) => s.id === added.id)).toBe(false);
    const history = (await builderForAdmin(sa)).history;
    const first = history.find((h) => h.note === "TEST first")!;
    expect(first.status).toBe("superseded");
    expect(await restoreHomeRevision(sa, "d:stale", first.id)).toEqual({ status: "stale" });
    expect(await restoreHomeRevision(sa, await base(), first.id)).toEqual({ status: "ok" });
    expect(await shopHomeDocument()).toEqual(draft.document);
    expect((await builderForAdmin(sa)).history[0]).toMatchObject({ status: "published", restoredFrom: first.revisionNo, note: null });
    expect(await restoreHomeRevision(sa, await base(), "00000000-0000-0000-0000-000000000000")).toEqual({ status: "not_found" });

    // Exactly one published revision; history is kept.
    expect(await q("SELECT 1 FROM page_revisions WHERE page_id = $1 AND status = 'published'", [pageId])).toHaveLength(1);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM page_revisions WHERE page_id = $1 AND status = 'superseded'", [pageId]))[0]!.n).toBeGreaterThanOrEqual(2);
    for (const action of ["pagebuilder.draft_saved", "pagebuilder.published", "pagebuilder.restored"]) {
      expect((await q("SELECT 1 FROM audit_logs WHERE actor_user_id = $1 AND action = $2", [sa.userId, action])).length).toBeGreaterThan(0);
    }
  });

  it("a form built before another editor published is stale, even with no draft on either side", async () => {
    const other = await actorFor("super_admin");
    const opened = await base();
    expect(opened).toMatch(/^p:/);
    expect(await editHome(other, opened, { kind: "add", type: "richText" })).toEqual({ status: "ok" });
    expect(await publishHome(other, (await builderForAdmin(other)).base, "")).toEqual({ status: "ok" });
    // No draft again, but the published revision moved on.
    for (const r of [
      await editHome(sa, opened, { kind: "add", type: "callout" }),
      await discardHomeDraft(sa, opened),
      await restoreHomeRevision(sa, opened, (await builderForAdmin(sa)).history[1]!.id),
    ]) {
      expect(r).toEqual({ status: "stale" });
    }
    // Clean up: take the text section out again.
    const doc = (await builderForAdmin(sa)).document;
    expect(await editHome(sa, await base(), { kind: "remove", id: doc.sections.at(-1)!.id })).toEqual({ status: "ok" });
    expect(await publishHome(sa, await base(), "")).toEqual({ status: "ok" });
  });

  it("the database keeps revisions unchanged and one published per page", async () => {
    const pageId = await homeId();
    const page = (await q<{ published_revision_id: string }>("SELECT published_revision_id FROM pages WHERE id = $1", [pageId]))[0]!;
    await expect(q("UPDATE page_revisions SET document = '{}' WHERE id = $1", [page.published_revision_id])).rejects.toThrow();
    await expect(q("DELETE FROM page_revisions WHERE id = $1", [page.published_revision_id])).rejects.toThrow();
    await expect(q("UPDATE page_revisions SET status = 'draft' WHERE id = $1", [page.published_revision_id])).rejects.toThrow();
    await expect(q("UPDATE page_revisions SET note = 'x' WHERE id = $1", [page.published_revision_id])).rejects.toThrow();
    const superseded = (await q<{ id: string }>("SELECT id FROM page_revisions WHERE page_id = $1 AND status = 'superseded' LIMIT 1", [pageId]))[0]!;
    await expect(q("UPDATE page_revisions SET status = 'published' WHERE id = $1", [superseded.id])).rejects.toThrow();
    await expect(
      q(
        `INSERT INTO page_revisions (page_id, revision_no, schema_version, document, status, created_by, published_by, published_at)
         SELECT $1, max(revision_no) + 1, 1, '{}'::jsonb, 'published', $2, $2, now() FROM page_revisions WHERE page_id = $1`,
        [pageId, sa.userId],
      ),
    ).rejects.toThrow(/page_revisions_one_published/);
  });

  it("a stored document that fails the registry is never rendered", async () => {
    const pageId = await homeId();
    const live = await shopHomeDocument();
    await q(
      `INSERT INTO page_revisions (page_id, revision_no, schema_version, document, status, created_by)
       SELECT $1, max(revision_no) + 1, 1, $2::jsonb, 'draft', $3 FROM page_revisions WHERE page_id = $1`,
      [pageId, JSON.stringify({ version: 1, sections: [{ id: "html0001", type: "html", visibility: {}, props: { html: "<script>alert(1)</script>" } }] }), sa.userId],
    );
    expect(await previewHomeDocument(sa)).toEqual(live);
    expect((await builderForAdmin(sa)).source).toBe("published");
    expect(await discardHomeDraft(sa, await base())).toEqual({ status: "ok" });
    expect(DEFAULT_HOME.sections.map((s) => s.type)).toEqual(["bannerSlider", "hero", "motorcycles", "categories", "latestProducts"]);
  });

  it("a revision of another page can't be restored into the home page", async () => {
    const [other] = await q<{ id: string }>("INSERT INTO pages (key, status) VALUES ($1, 'draft') RETURNING id", [`test-${Date.now()}`]);
    const [rev] = await q<{ id: string }>(
      `INSERT INTO page_revisions (page_id, revision_no, schema_version, document, status, created_by, published_by, published_at)
       VALUES ($1, 1, 1, $2::jsonb, 'published', $3, $3, now()) RETURNING id`,
      [other!.id, JSON.stringify(DEFAULT_HOME), sa.userId],
    );
    expect(await restoreHomeRevision(sa, await base(), rev!.id)).toEqual({ status: "not_found" });
  });

  it("only pagebuilder.publish publishes or restores; edit alone can't", async () => {
    const permissions = new Map(sa.permissions);
    permissions.delete("pagebuilder.publish");
    const editor = { ...sa, permissions };
    expect((await builderForAdmin(editor)).canPublish).toBe(false);
    expect(await editHome(editor, await base(), { kind: "add", type: "callout" })).toEqual({ status: "ok" });
    await expect(publishHome(editor, await base(), "")).rejects.toBeInstanceOf(AuthzError);
    await expect(restoreHomeRevision(editor, await base(), (await builderForAdmin(sa)).history[0]!.id)).rejects.toBeInstanceOf(AuthzError);
    expect(await discardHomeDraft(editor, await base())).toEqual({ status: "ok" });
  });

  it("Business Admins and Store Staff can't use the builder at all", async () => {
    const categoryId = (await q<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id"))[0]!.id;
    for (const actor of [await actorFor("business_admin"), await actorFor("store_staff", [categoryId])]) {
      await expect(builderForAdmin(actor)).rejects.toBeInstanceOf(AuthzError);
      await expect(previewHomeDocument(actor)).rejects.toBeInstanceOf(AuthzError);
      await expect(editHome(actor, "p:none", { kind: "add", type: "callout" })).rejects.toBeInstanceOf(AuthzError);
      await expect(discardHomeDraft(actor, "p:none")).rejects.toBeInstanceOf(AuthzError);
      await expect(publishHome(actor, "p:none", "")).rejects.toBeInstanceOf(AuthzError);
      await expect(restoreHomeRevision(actor, "p:none", "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(AuthzError);
    }
    await expect(editHome({ ...sa, kind: "customer" }, "p:none", { kind: "add", type: "callout" })).rejects.toBeInstanceOf(AuthzError);
  });
});
