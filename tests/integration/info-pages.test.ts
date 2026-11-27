import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { infoPageForAdmin, infoPagesForAdmin, saveInfoPage, shopInfoPage, shopInfoPageLinks } from "@/modules/content/service/info-pages";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";

afterAll(async () => {
  await prisma().$disconnect();
});

describe("information pages", () => {
  it("publishes each save as a new revision, keeps the old ones and audits it", async () => {
    const admin = await actorFor("business_admin");
    const first = await saveInfoPage(admin, "returns", { faTitle: "بازگشت کالا", faBody: "## شرایط\n- تا ۷ روز", enTitle: "", enBody: "" });
    expect(first.status).toBe("ok");
    const second = await saveInfoPage(admin, "returns", { faTitle: "بازگشت کالا", faBody: "متن تازه", enTitle: "Returns", enBody: "New text" });
    expect(second).toEqual({ status: "ok", revisionNo: (first as { revisionNo: number }).revisionNo + 1 });

    const revisions = await q<{ revision_no: number; status: string }>(
      "SELECT r.revision_no, r.status FROM page_revisions r JOIN pages p ON p.id = r.page_id WHERE p.key = 'returns' ORDER BY r.revision_no DESC LIMIT 2",
    );
    expect(revisions.map((r) => r.status)).toEqual(["published", "superseded"]);
    const [audit] = await q<{ after: { revisionNo: number } }>("SELECT after FROM audit_logs WHERE action = 'content.page_published' AND actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1", [admin.userId]);
    expect(audit?.after.revisionNo).toBe(revisions[0]!.revision_no);

    expect(await infoPageForAdmin(admin, "returns")).toMatchObject({ faBody: "متن تازه", enTitle: "Returns", enBody: "New text" });
    expect(await shopInfoPage("en", "returns")).toMatchObject({ title: "Returns", lang: "en", isFallback: false, blocks: [{ type: "paragraph", text: "New text" }] });
    expect((await shopInfoPageLinks("fa")).find((l) => l.key === "returns")).toEqual({ key: "returns", title: "بازگشت کالا", lang: "fa" });
  });

  it("shows the Persian text on the English site when there is no English version, and drops the old English title", async () => {
    const staff = await actorFor("store_staff");
    await saveInfoPage(staff, "privacy", { faTitle: "حریم خصوصی", faBody: "متن", enTitle: "Privacy", enBody: "Text" });
    await saveInfoPage(staff, "privacy", { faTitle: "حریم خصوصی", faBody: "متن", enTitle: "", enBody: "" });
    expect(await shopInfoPage("en", "privacy")).toMatchObject({ title: "حریم خصوصی", lang: "fa", isFallback: true, hasEnglish: false });
    expect((await shopInfoPageLinks("en")).find((l) => l.key === "privacy")).toEqual({ key: "privacy", title: "حریم خصوصی", lang: "fa" });
  });

  it("refuses unknown pages and invalid text without writing", async () => {
    const admin = await actorFor("super_admin");
    expect(await saveInfoPage(admin, "secret", { faTitle: "x", faBody: "x", enTitle: "", enBody: "" })).toEqual({ status: "not_found" });
    expect(await saveInfoPage(admin, "terms", { faTitle: "", faBody: "x", enTitle: "", enBody: "" })).toEqual({ status: "invalid", field: "title_required" });
    expect(await infoPageForAdmin(admin, "secret")).toBeNull();
    expect(await shopInfoPage("fa", "secret")).toBeNull();
    const [pages] = await q<{ n: string }>("SELECT count(*) AS n FROM pages WHERE key = 'secret'");
    expect(Number(pages!.n)).toBe(0);
    expect((await infoPagesForAdmin(admin)).map((p) => p.key)).toEqual(["about", "contact", "shipping", "returns", "terms", "privacy"]);
  });

  it("denies admins without content.manage", async () => {
    const admin = await actorFor("business_admin");
    const without = { ...admin, permissions: new Map() };
    await expect(infoPagesForAdmin(without)).rejects.toBeInstanceOf(AuthzError);
    await expect(infoPageForAdmin(without, "about")).rejects.toBeInstanceOf(AuthzError);
    await expect(saveInfoPage(without, "about", { faTitle: "x", faBody: "x", enTitle: "", enBody: "" })).rejects.toBeInstanceOf(AuthzError);
    const customer = { ...admin, kind: "customer" as const };
    await expect(saveInfoPage(customer as never, "about", { faTitle: "x", faBody: "x", enTitle: "", enBody: "" })).rejects.toBeInstanceOf(AuthzError);
  });
});
