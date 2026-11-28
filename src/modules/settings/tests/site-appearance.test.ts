import { describe, expect, it } from "vitest";
import { EMPTY_SITE, isSocialLink, parseSiteInput, pick, pickWithLang, readSiteAppearance, SOCIAL_NETWORKS, type SiteInput } from "../domain/site-appearance";

const blank: SiteInput = {
  nameFa: "",
  nameEn: "",
  taglineFa: "",
  taglineEn: "",
  seoTitleFa: "",
  seoTitleEn: "",
  seoDescriptionFa: "",
  seoDescriptionEn: "",
  footerNoteFa: "",
  footerNoteEn: "",
  social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, ""])) as SiteInput["social"],
  announcementEnabled: false,
  announcementFa: "",
  announcementEn: "",
  announcementHref: "",
  announcementTone: "orange",
};

describe("site appearance settings", () => {
  it("an empty form is the empty settings (built-in wording everywhere)", () => {
    expect(parseSiteInput(blank)).toEqual({ value: EMPTY_SITE });
    expect(readSiteAppearance(undefined)).toEqual(EMPTY_SITE);
    expect(readSiteAppearance({ name: "x" })).toEqual(EMPTY_SITE);
  });

  it("normalizes text: one line for names, kept line breaks for the footer note, no control or bidi characters", () => {
    const r = parseSiteInput({ ...blank, nameFa: "  کلیك ‮لوازم  ", footerNoteFa: "خط اول\r\n\r\n\r\n\u0007خط دوم  " });
    expect(r).toMatchObject({ value: { name: { fa: "کلیک لوازم" }, footerNote: { fa: "خط اول\n\nخط دوم" } } });
  });

  it("refuses text over the limits and names the field", () => {
    expect(parseSiteInput({ ...blank, nameEn: "a".repeat(61) })).toEqual({ field: "name_too_long" });
    expect(parseSiteInput({ ...blank, seoDescriptionFa: "ب".repeat(201) })).toEqual({ field: "seoDescription_too_long" });
  });

  it("takes social links only on each network's own https hosts", () => {
    expect(isSocialLink("instagram", "https://www.instagram.com/clicksp")).toBe(true);
    expect(isSocialLink("telegram", "https://t.me/clicksp")).toBe(true);
    expect(isSocialLink("instagram", "http://instagram.com/clicksp")).toBe(false);
    expect(isSocialLink("instagram", "https://instagram.com.evil.test/x")).toBe(false);
    expect(isSocialLink("instagram", "https://instagram.com/")).toBe(false);
    expect(isSocialLink("whatsapp", "https://user:pw@wa.me/98912")).toBe(false);
    expect(isSocialLink("telegram", "javascript:alert(1)")).toBe(false);
    expect(parseSiteInput({ ...blank, social: { ...blank.social, telegram: "https://evil.test/x" } })).toEqual({ field: "social_telegram_invalid" });
    expect(parseSiteInput({ ...blank, social: { ...blank.social, aparat: " https://www.aparat.com/clicksp " } })).toMatchObject({ value: { social: { aparat: "https://www.aparat.com/clicksp" } } });
  });

  it("the announcement needs Persian text when shown, and its link is a store path or https", () => {
    expect(parseSiteInput({ ...blank, announcementEnabled: true })).toEqual({ field: "announcement_fa_required" });
    expect(parseSiteInput({ ...blank, announcementHref: "javascript:alert(1)" })).toEqual({ field: "announcement_link_invalid" });
    expect(parseSiteInput({ ...blank, announcementHref: "//evil.test" })).toEqual({ field: "announcement_link_invalid" });
    expect(parseSiteInput({ ...blank, announcementTone: "red" })).toEqual({ field: "invalid" });
    expect(parseSiteInput({ ...blank, announcementEnabled: true, announcementFa: "ارسال رایگان", announcementHref: "/fa/c/brakes", announcementTone: "charcoal" })).toMatchObject({
      value: { announcement: { enabled: true, text: { fa: "ارسال رایگان", en: "" }, href: "/c/brakes", tone: "charcoal" } },
    });
  });

  it("picks wording per language", () => {
    expect(pick({ fa: "الف", en: "" }, "en")).toBeNull();
    expect(pick({ fa: "الف", en: "" }, "fa")).toBe("الف");
    expect(pickWithLang({ fa: "الف", en: "" }, "en")).toEqual({ text: "الف", lang: "fa" });
    expect(pickWithLang({ fa: "الف", en: "A" }, "en")).toEqual({ text: "A" });
    expect(pickWithLang({ fa: "", en: "A" }, "fa")).toBeNull();
  });
});
