import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { EMPTY_SITE, SOCIAL_NETWORKS, type SiteInput } from "@/modules/settings/domain/site-appearance";
import { saveSiteAppearance, siteAppearanceForAdmin } from "@/modules/settings/service/site-appearance";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";

afterAll(async () => {
  await q("DELETE FROM store_settings WHERE key = 'store.site'");
  await prisma().$disconnect();
});

const input: SiteInput = {
  nameFa: "TEST نام",
  nameEn: "",
  taglineFa: "",
  taglineEn: "",
  seoTitleFa: "TEST عنوان",
  seoTitleEn: "",
  seoDescriptionFa: "",
  seoDescriptionEn: "",
  footerNoteFa: "TEST متن فوتر",
  footerNoteEn: "",
  social: { ...(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, ""])) as SiteInput["social"]), telegram: "https://t.me/TEST" },
  announcementEnabled: true,
  announcementFa: "TEST اطلاعیه",
  announcementEn: "",
  announcementHref: "/blog",
  announcementTone: "orange",
};

describe("site appearance", () => {
  it("is empty (built-in wording) before anything is saved", async () => {
    await q("DELETE FROM store_settings WHERE key = 'store.site'");
    expect(await siteAppearanceForAdmin(await actorFor("business_admin"))).toEqual(EMPTY_SITE);
  });

  it("saves the settings and audits the change with the value it replaced", async () => {
    const admin = await actorFor("business_admin");
    expect(await saveSiteAppearance(admin, input)).toEqual({ status: "ok" });
    expect(await siteAppearanceForAdmin(admin)).toMatchObject({
      name: { fa: "TEST نام", en: "" },
      social: { telegram: "https://t.me/TEST", instagram: "" },
      announcement: { enabled: true, text: { fa: "TEST اطلاعیه" }, href: "/blog" },
    });
    expect(await saveSiteAppearance(admin, { ...input, nameFa: "TEST نام دوم" })).toEqual({ status: "ok" });
    const [audit] = await q<{ before: { value: { name: { fa: string } } }; after: { value: { name: { fa: string } } } }>(
      "SELECT before, after FROM audit_logs WHERE action = 'settings.store.site_updated' AND actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [admin.userId],
    );
    expect(audit?.before.value.name.fa).toBe("TEST نام");
    expect(audit?.after.value.name.fa).toBe("TEST نام دوم");
  });

  it("refuses invalid settings without writing", async () => {
    const admin = await actorFor("super_admin");
    const before = await siteAppearanceForAdmin(admin);
    expect(await saveSiteAppearance(admin, { ...input, social: { ...input.social, instagram: "https://evil.test/x" } })).toEqual({ status: "invalid", field: "social_instagram_invalid" });
    expect(await saveSiteAppearance(admin, { ...input, announcementHref: "javascript:alert(1)" })).toEqual({ status: "invalid", field: "announcement_link_invalid" });
    expect(await siteAppearanceForAdmin(admin)).toEqual(before);
  });

  it("denies Store Staff, admins without settings.store and customers", async () => {
    const staff = await actorFor("store_staff");
    await expect(siteAppearanceForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(saveSiteAppearance(staff, input)).rejects.toBeInstanceOf(AuthzError);
    const admin = await actorFor("business_admin");
    const without = { ...admin, permissions: new Map() };
    await expect(siteAppearanceForAdmin(without)).rejects.toBeInstanceOf(AuthzError);
    await expect(saveSiteAppearance(without, input)).rejects.toBeInstanceOf(AuthzError);
    const customer = { ...admin, kind: "customer" as const };
    await expect(saveSiteAppearance(customer as never, input)).rejects.toBeInstanceOf(AuthzError);
  });
});
