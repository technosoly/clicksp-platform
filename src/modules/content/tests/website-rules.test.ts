import { describe, expect, it } from "vitest";
import { parseArticle } from "../domain/article";
import { bannerLive, parseBanner, tehranDayStart } from "../domain/banner";
import { parseHref } from "../domain/links";
import { parseMenu } from "../domain/menu";

describe("links typed into menus and banners", () => {
  it("takes store paths and https addresses", () => {
    expect(parseHref("/c/brakes")).toEqual({ kind: "internal", path: "/c/brakes" });
    expect(parseHref("/fa/pages/about")).toEqual({ kind: "internal", path: "/pages/about" });
    expect(parseHref("/en")).toEqual({ kind: "internal", path: "/" });
    expect(parseHref("https://example.ir/x")).toEqual({ kind: "external", url: "https://example.ir/x" });
  });

  it("refuses anything that could leave the store unexpectedly or run code", () => {
    for (const bad of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "http://example.ir", "https://user:pw@example.ir", "data:text/html,x", "c/brakes", "/a b", "/a\u0000", "https://localhost", ""]) {
      expect(parseHref(bad)).toBeNull();
    }
  });
});

describe("menus", () => {
  it("keeps filled rows, skips empty ones and names the problem", () => {
    const empty = { fa: "", en: "", href: "" };
    expect(parseMenu("header", [{ fa: "لنت", en: "Pads", href: "/c/pads" }, empty, { fa: "راهنما", en: "", href: "https://example.ir" }])).toEqual({
      version: 1,
      items: [
        { label: { fa: "لنت", en: "Pads" }, href: "/c/pads" },
        { label: { fa: "راهنما" }, href: "https://example.ir/" },
      ],
    });
    expect(parseMenu("header", [{ fa: "", en: "Pads", href: "/c/pads" }])).toEqual({ field: "menu_label_required", row: 1 });
    expect(parseMenu("footer", [empty, { fa: "x", en: "", href: "javascript:alert(1)" }])).toEqual({ field: "invalid_link", row: 2 });
  });

  it("ignores rows beyond the menu's size", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ fa: `پیوند ${i}`, en: "", href: `/p${i}` }));
    const parsed = parseMenu("header", rows);
    expect("items" in parsed && parsed.items).toHaveLength(6);
  });
});

describe("banners", () => {
  const base = { faTitle: "حراج", faSubtitle: "", faCta: "", faAlt: "", enTitle: "", enSubtitle: "", enCta: "", enAlt: "", href: "", sortOrder: "", isActive: true, startsOn: "", endsOn: "" };

  it("uses the title as the picture description and needs a link for a button", () => {
    const parsed = parseBanner(base);
    expect("fa" in parsed && parsed.fa).toEqual({ title: "حراج", subtitle: null, ctaLabel: null, alt: "حراج" });
    expect(parseBanner({ ...base, faCta: "خرید" })).toEqual({ field: "cta_needs_link" });
    expect(parseBanner({ ...base, href: "//evil" })).toEqual({ field: "invalid_link" });
    expect(parseBanner({ ...base, sortOrder: "1.5" })).toEqual({ field: "invalid_order" });
  });

  it("shows a banner from the first day to the end of the last day, Tehran time", () => {
    const parsed = parseBanner({ ...base, startsOn: "2026-12-01", endsOn: "2026-12-01" });
    if ("field" in parsed) throw new Error(parsed.field);
    expect(parsed.startsAt?.toISOString()).toBe("2026-11-30T20:30:00.000Z");
    expect(parsed.endsAt?.toISOString()).toBe("2026-12-01T20:30:00.000Z");
    expect(bannerLive(parsed, new Date("2026-12-01T20:29:00Z"))).toBe(true);
    expect(bannerLive(parsed, new Date("2026-12-01T20:30:00Z"))).toBe(false);
    expect(parseBanner({ ...base, startsOn: "2026-12-02", endsOn: "2026-12-01" })).toEqual({ field: "end_before_start" });
    expect(tehranDayStart("2026-02-30")).toBeNull();
  });
});

describe("articles", () => {
  const base = { status: "draft", faTitle: "تعویض لنت ترمز", faSlug: "", faExcerpt: "", faBody: "## مراحل\n\n- چرخ را باز کنید", enTitle: "", enSlug: "", enExcerpt: "", enBody: "" };

  it("makes the address from the title and keeps the text as blocks", () => {
    const parsed = parseArticle(base);
    if ("field" in parsed) throw new Error(parsed.field);
    expect(parsed.fa.slug).toBe("تعویض-لنت-ترمز");
    expect(parsed.fa.body.blocks).toEqual([{ type: "heading", text: "مراحل" }, { type: "list", items: ["چرخ را باز کنید"] }]);
    expect(parsed.en).toBeNull();
  });

  it("needs English to be complete when any of it is given, and a known status", () => {
    expect(parseArticle({ ...base, enTitle: "Brake pads" })).toEqual({ field: "english_incomplete" });
    expect(parseArticle({ ...base, status: "live" })).toEqual({ field: "invalid_status" });
    expect(parseArticle({ ...base, faBody: "" })).toEqual({ field: "fa_body_required" });
    const en = parseArticle({ ...base, enTitle: "Changing brake pads", enBody: "Step one." });
    expect("en" in en && en.en?.slug).toBe("changing-brake-pads");
  });

  it("never keeps markup as markup", () => {
    const parsed = parseArticle({ ...base, faBody: "<script>alert(1)</script>" });
    if ("field" in parsed) throw new Error(parsed.field);
    expect(parsed.fa.body.blocks).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});
