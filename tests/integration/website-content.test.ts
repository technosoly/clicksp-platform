/**
 * Articles, menus and banners through the real services on PostgreSQL. All
 * text is synthetic (TEST ...).
 */
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db as prisma } from "@/lib/db";
import { articleForAdmin, articlesForAdmin, createArticle, deleteArticle, saveArticle, setArticleCover, shopArticle, shopArticles } from "@/modules/content/service/articles";
import { bannersForAdmin, createBanner, deleteBanner, saveBanner, setBannerImage, shopBanners } from "@/modules/content/service/banners";
import { menusForAdmin, saveMenu, shopMenu } from "@/modules/content/service/menus";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const png = async (width = 1600, height = 600) => ({
  name: "banner.png",
  bytes: new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#c65a19" } }).png().toBuffer()),
});

const article = (id: string, over: Partial<Record<string, string>> = {}) => ({
  status: "draft",
  faTitle: `TEST مقاله ${id}`,
  faSlug: "",
  faExcerpt: "خلاصه",
  faBody: "## بخش\n\nمتن مقاله.",
  enTitle: "",
  enSlug: "",
  enExcerpt: "",
  enBody: "",
  ...over,
});

describe("articles", () => {
  it("a Business Admin writes, publishes and deletes; the store shows only published ones", async () => {
    const ba = await actorFor("business_admin");
    const id = uid().toLowerCase();
    const created = await createArticle(ba, article(id, { enTitle: `TEST article ${id}`, enBody: "Text." }));
    if (created.status !== "ok") throw new Error(JSON.stringify(created));
    expect(await shopArticle("fa", `test-مقاله-${id}`)).toBeNull();

    expect((await saveArticle(ba, created.id, article(id, { status: "published", enTitle: `TEST article ${id}`, enBody: "Text." }))).status).toBe("ok");
    const fa = await shopArticle("fa", `test-مقاله-${id}`);
    expect(fa?.title).toBe(`TEST مقاله ${id}`);
    expect(fa?.blocks[0]).toEqual({ type: "heading", text: "بخش" });
    const en = await shopArticle("en", `test-article-${id}`);
    expect(en?.lang).toBe("en");
    // The Persian address in English finds the article and points to its English address.
    expect((await shopArticle("en", `test-مقاله-${id}`))?.canonicalSlug).toBe(`test-article-${id}`);
    expect((await shopArticles("fa")).items.some((a) => a.id === created.id)).toBe(true);

    const firstPublished = (await q<{ published_at: Date }>("SELECT published_at FROM articles WHERE id = $1", [created.id]))[0]!.published_at;
    await saveArticle(ba, created.id, article(id, { status: "archived" }));
    expect(await shopArticle("fa", `test-مقاله-${id}`)).toBeNull();
    await saveArticle(ba, created.id, article(id, { status: "published" }));
    const again = (await q<{ published_at: Date }>("SELECT published_at FROM articles WHERE id = $1", [created.id]))[0]!.published_at;
    expect(again).toEqual(firstPublished);
    // English removed: the English page falls back to Persian.
    expect((await shopArticle("en", `test-مقاله-${id}`))?.isFallback).toBe(true);

    expect(await createArticle(ba, article(id))).toEqual({ status: "invalid", field: "fa_slug_taken" });
    expect((await setArticleCover(ba, created.id, await png(1200, 675))).status).toBe("ok");
    expect((await articleForAdmin(ba, created.id))?.cover.length).toBeGreaterThan(0);

    expect((await deleteArticle(ba, created.id)).status).toBe("ok");
    expect(await shopArticle("fa", `test-مقاله-${id}`)).toBeNull();
    expect(await articleForAdmin(ba, created.id)).toBeNull();
    expect(await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'article.deleted'", [created.id])).toHaveLength(1);
    // Its address can be used again.
    expect((await createArticle(ba, article(id))).status).toBe("ok");
  });

  it("Store Staff write drafts only; an admin publishes; then staff can't change it", async () => {
    const categoryId = (await q<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id"))[0]!.id;
    const staff = await actorFor("store_staff", [categoryId]);
    const ba = await actorFor("business_admin");
    const id = uid().toLowerCase();
    expect((await articlesForAdmin(staff)).canPublish).toBe(false);
    await expect(createArticle(staff, article(id, { status: "published" }))).rejects.toBeInstanceOf(AuthzError);
    const draft = await createArticle(staff, article(id));
    if (draft.status !== "ok") throw new Error(JSON.stringify(draft));
    expect((await saveArticle(staff, draft.id, article(id, { faExcerpt: "ویرایش" }))).status).toBe("ok");
    await expect(saveArticle(staff, draft.id, article(id, { status: "published" }))).rejects.toBeInstanceOf(AuthzError);
    await expect(deleteArticle(staff, draft.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(setArticleCover(staff, draft.id, null)).rejects.toBeInstanceOf(AuthzError);

    expect(await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'article.updated' AND actor_user_id = $2", [draft.id, staff.userId])).toHaveLength(1);

    // A draft isn't on the store, in either language.
    expect(await shopArticle("fa", `test-مقاله-${id}`)).toBeNull();
    expect(await shopArticle("en", `test-مقاله-${id}`)).toBeNull();

    expect((await saveArticle(ba, draft.id, article(id, { status: "published" }))).status).toBe("ok");
    expect((await articleForAdmin(staff, draft.id))?.canEdit).toBe(false);
    await expect(saveArticle(staff, draft.id, article(id))).rejects.toBeInstanceOf(AuthzError);
    await expect(deleteArticle(staff, draft.id)).rejects.toBeInstanceOf(AuthzError);
    expect((await saveArticle(ba, draft.id, article(id, { status: "archived" }))).status).toBe("ok");
    await expect(saveArticle(staff, draft.id, article(id))).rejects.toBeInstanceOf(AuthzError);

    // A publication date in the future keeps the article off the store until then.
    expect((await saveArticle(ba, draft.id, article(id, { status: "published" }))).status).toBe("ok");
    await q("UPDATE articles SET published_at = now() + interval '1 day' WHERE id = $1", [draft.id]);
    expect(await shopArticle("fa", `test-مقاله-${id}`)).toBeNull();

    // A staff grant naming no category can't even write drafts.
    const unscopedStaff = await actorFor("store_staff");
    await expect(createArticle(unscopedStaff, article(uid()))).rejects.toBeInstanceOf(AuthzError);
  });

  it("a Super Admin manages articles, menus and banners too", async () => {
    const sa = await actorFor("super_admin");
    const created = await createArticle(sa, article(uid().toLowerCase(), { status: "published" }));
    expect(created.status).toBe("ok");
    expect(await saveMenu(sa, "footer", [{ fa: "TEST پیوند", en: "", href: "/blog" }])).toEqual({ status: "ok" });
    const banner = await createBanner(sa, "home_hero", { faTitle: "TEST", faSubtitle: "", faCta: "", faAlt: "", enTitle: "", enSubtitle: "", enCta: "", enAlt: "", href: "", sortOrder: "", isActive: false, startsOn: "", endsOn: "" }, await png());
    expect(banner.status).toBe("ok");
    if (banner.status === "ok") expect((await deleteBanner(sa, banner.id)).status).toBe("ok");
  });

  it("refuses staff without the permission and customers", async () => {
    const staff = await actorFor("store_staff");
    const sa = await actorFor("super_admin");
    const customer = { ...sa, kind: "customer" as const };
    await expect(articlesForAdmin(customer)).rejects.toBeInstanceOf(AuthzError);
    await expect(createArticle(customer, article(uid()))).rejects.toBeInstanceOf(AuthzError);
    const noArticles = { ...staff, permissions: new Map([...staff.permissions].filter(([k]) => k !== "article.manage")) };
    await expect(articlesForAdmin(noArticles)).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("menus", () => {
  it("saves the header and footer links and shows them in the visitor's language", async () => {
    const ba = await actorFor("business_admin");
    const empty = { fa: "", en: "", href: "" };
    expect(await saveMenu(ba, "header", [{ fa: "لنت", en: "", href: "javascript:alert(1)" }])).toEqual({ status: "invalid", field: "invalid_link", row: 1 });
    expect(await saveMenu(ba, "header", [{ fa: "TEST لنت", en: "TEST pads", href: "/c/pads" }, empty, { fa: "TEST بیرون", en: "", href: "https://example.ir" }])).toEqual({ status: "ok" });
    expect(await shopMenu("header", "en")).toEqual([
      { label: "TEST pads", lang: "en", href: { kind: "internal", path: "/c/pads" } },
      { label: "TEST بیرون", lang: "fa", href: { kind: "external", url: "https://example.ir/" } },
    ]);
    expect((await menusForAdmin(ba))[0]?.rows[0]).toEqual({ fa: "TEST لنت", en: "TEST pads", href: "/c/pads" });
    expect(await saveMenu(ba, "sidebar", [])).toEqual({ status: "not_found" });
    expect(await q("SELECT 1 FROM audit_logs WHERE action = 'menu.saved'")).not.toHaveLength(0);
    // A document changed behind the service is checked again before it's shown.
    await q(`INSERT INTO menus (key, location, schema_version, document) VALUES ('footer', 'footer', 1, '{"version":1,"items":[{"label":{"fa":"x"},"href":"javascript:alert(1)"}]}') ON CONFLICT (key) DO UPDATE SET document = EXCLUDED.document`);
    expect(await shopMenu("footer", "fa")).toEqual([]);
  });

  it("refuses Store Staff", async () => {
    const staff = await actorFor("store_staff");
    await expect(menusForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(saveMenu(staff, "header", [])).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("banners", () => {
  const text = (over: Record<string, unknown> = {}) => ({
    faTitle: "TEST حراج",
    faSubtitle: "",
    faCta: "خرید",
    faAlt: "",
    enTitle: "",
    enSubtitle: "",
    enCta: "",
    enAlt: "",
    href: "/c/pads",
    sortOrder: "0",
    isActive: true,
    startsOn: "",
    endsOn: "",
    ...over,
  });

  it("creates a banner with its picture, shows it while live, and deletes its pictures with it", async () => {
    const ba = await actorFor("business_admin");
    expect(await createBanner(ba, "home_hero", text(), null)).toEqual({ status: "invalid", field: "image_missing" });
    const created = await createBanner(ba, "home_hero", text(), await png());
    if (created.status !== "ok") throw new Error(JSON.stringify(created));
    const live = await shopBanners("en");
    const mine = live.find((b) => b.id === created.id);
    expect(mine?.title).toBe("TEST حراج");
    expect(mine?.href).toEqual({ kind: "internal", path: "/c/pads" });
    expect(mine?.desktop.length).toBeGreaterThan(0);

    expect((await setBannerImage(ba, created.id, "mobile", await png(800, 600))).status).toBe("ok");
    expect(await setBannerImage(ba, created.id, "desktop", null)).toEqual({ status: "invalid", field: "image_missing" });

    expect((await saveBanner(ba, created.id, text({ startsOn: "2099-01-01" }))).status).toBe("ok");
    expect((await shopBanners("fa")).some((b) => b.id === created.id)).toBe(false);
    expect((await bannersForAdmin(ba)).find((b) => b.id === created.id)?.live).toBe(false);
    expect(await saveBanner(ba, created.id, text({ href: "//evil.example" }))).toEqual({ status: "invalid", field: "invalid_link" });

    const { desktop_media_id: desktop, mobile_media_id: mobile } = (await q<{ desktop_media_id: string; mobile_media_id: string }>("SELECT desktop_media_id, mobile_media_id FROM banners WHERE id = $1", [created.id]))[0]!;
    expect((await deleteBanner(ba, created.id)).status).toBe("ok");
    expect(await q("SELECT 1 FROM banners WHERE id = $1", [created.id])).toHaveLength(0);
    expect(await q("SELECT 1 FROM media_library WHERE id = ANY($1) AND deleted_at IS NULL", [[desktop, mobile]])).toHaveLength(0);
  });

  it("refuses Store Staff and customers", async () => {
    const staff = await actorFor("store_staff");
    await expect(bannersForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(createBanner(staff, "home_hero", text(), await png())).rejects.toBeInstanceOf(AuthzError);
    const ba = await actorFor("business_admin");
    const created = await createBanner(ba, "home_hero", text({ isActive: false }), await png());
    if (created.status !== "ok") throw new Error(JSON.stringify(created));
    await expect(saveBanner(staff, created.id, text())).rejects.toBeInstanceOf(AuthzError);
    await expect(setBannerImage(staff, created.id, "mobile", null)).rejects.toBeInstanceOf(AuthzError);
    await expect(deleteBanner(staff, created.id)).rejects.toBeInstanceOf(AuthzError);
    const sa = await actorFor("super_admin");
    await expect(bannersForAdmin({ ...sa, kind: "customer" as const })).rejects.toBeInstanceOf(AuthzError);
  });
});
