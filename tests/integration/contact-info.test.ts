import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { EMPTY_CONTACT } from "@/modules/settings/domain/contact-info";
import { contactInfoForAdmin, saveContactInfo, shopContactInfo } from "@/modules/settings/service/contact-info";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";

afterAll(async () => {
  await q("DELETE FROM store_settings WHERE key = 'store.contact'");
  await prisma().$disconnect();
});

const input = {
  addressFa: "TEST نشانی آزمایشی",
  addressEn: "",
  hoursFa: "TEST ۹ تا ۱۸",
  hoursEn: "",
  phones: ["021-0000 0000", "", ""],
  email: "TEST@example.test",
  google: "https://maps.app.goo.gl/TEST",
  neshan: "",
  balad: "",
  googleEmbed: "",
};

describe("contact details", () => {
  it("saves the details, shows them to visitors and audits the change", async () => {
    const admin = await actorFor("business_admin");
    expect(await saveContactInfo(admin, input)).toEqual({ status: "ok" });
    const shown = await shopContactInfo();
    expect(shown).toMatchObject({ address: { fa: "TEST نشانی آزمایشی" }, phones: ["02100000000"], email: "test@example.test", maps: { google: "https://maps.app.goo.gl/TEST" } });
    expect(await contactInfoForAdmin(admin)).toEqual(shown);

    expect(await saveContactInfo(admin, { ...input, phones: ["02100000001", "", ""] })).toEqual({ status: "ok" });
    const [audit] = await q<{ before: { value: { phones: string[] } }; after: { value: { phones: string[] } } }>(
      "SELECT before, after FROM audit_logs WHERE action = 'settings.store.contact_updated' AND actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [admin.userId],
    );
    expect(audit?.before.value.phones).toEqual(["02100000000"]);
    expect(audit?.after.value.phones).toEqual(["02100000001"]);
    const [row] = await q<{ updated_by: string }>("SELECT updated_by FROM store_settings WHERE key = 'store.contact'");
    expect(row?.updated_by).toBe(admin.userId);
  });

  it("refuses invalid details without writing", async () => {
    const admin = await actorFor("super_admin");
    const before = await shopContactInfo();
    expect(await saveContactInfo(admin, { ...input, google: "https://evil.test/x" })).toEqual({ status: "invalid", field: "map_google_invalid" });
    expect(await shopContactInfo()).toEqual(before);
  });

  it("denies Store Staff, admins without settings.store and customers", async () => {
    const staff = await actorFor("store_staff");
    await expect(contactInfoForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(saveContactInfo(staff, input)).rejects.toBeInstanceOf(AuthzError);
    const admin = await actorFor("business_admin");
    const without = { ...admin, permissions: new Map() };
    await expect(contactInfoForAdmin(without)).rejects.toBeInstanceOf(AuthzError);
    await expect(saveContactInfo(without, input)).rejects.toBeInstanceOf(AuthzError);
    const customer = { ...admin, kind: "customer" as const };
    await expect(saveContactInfo(customer as never, input)).rejects.toBeInstanceOf(AuthzError);
  });

  it("shows nothing when the stored value is missing or broken", async () => {
    await q("DELETE FROM store_settings WHERE key = 'store.contact'");
    expect(await shopContactInfo()).toEqual(EMPTY_CONTACT);
    await q("INSERT INTO store_settings (key, value_type, value) VALUES ('store.contact', 'json', '{\"phones\": 1}')");
    expect(await shopContactInfo()).toEqual(EMPTY_CONTACT);
  });
});
