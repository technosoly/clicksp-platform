import { describe, expect, it } from "vitest";
import { bodyText, InfoPageDocument, isInfoPageKey, LIMITS, parseBody, parseInfoPage } from "../domain/info-page";

describe("information page text", () => {
  it("parses headings, paragraphs and lists, and prints them back", () => {
    const text = "## ارسال\nمرسوله‌ها با پست\nارسال می‌شوند.\n\n- تهران\n- اصفهان\n\nپایان";
    const parsed = parseBody(text);
    expect(parsed).toEqual({
      blocks: [
        { type: "heading", text: "ارسال" },
        { type: "paragraph", text: "مرسوله‌ها با پست\nارسال می‌شوند." },
        { type: "list", items: ["تهران", "اصفهان"] },
        { type: "paragraph", text: "پایان" },
      ],
    });
    const blocks = "blocks" in parsed ? parsed.blocks : [];
    expect(parseBody(bodyText(blocks))).toEqual({ blocks });
  });

  it("keeps markup as plain text and strips control and bidi-override characters", () => {
    const parsed = parseBody("<script>alert(1)</script>‮\u0007 <a href=\"javascript:x\">");
    expect(parsed).toEqual({ blocks: [{ type: "paragraph", text: '<script>alert(1)</script> <a href="javascript:x">' }] });
  });

  it("normalizes Arabic letters", () => {
    expect(parseBody("كيف")).toEqual({ blocks: [{ type: "paragraph", text: "کیف" }] });
  });

  it("refuses text over the limits", () => {
    expect(parseBody("a".repeat(LIMITS.body + 1))).toEqual({ error: "too_long" });
    expect(parseBody(`## ${"a".repeat(LIMITS.heading + 1)}`)).toEqual({ error: "block_too_long" });
    expect(parseBody(Array.from({ length: LIMITS.items + 1 }, () => "- x").join("\n"))).toEqual({ error: "block_too_long" });
    expect(parseBody(Array.from({ length: LIMITS.blocks + 1 }, () => "x").join("\n\n"))).toEqual({ error: "too_many_blocks" });
  });

  it("needs a Persian title and text; English is both or neither", () => {
    const ok = { faTitle: "دربارهٔ ما", faBody: "متن", enTitle: "", enBody: "" };
    expect(parseInfoPage({ ...ok, faTitle: "  " })).toEqual({ field: "title_required" });
    expect(parseInfoPage({ ...ok, faBody: "\n\n" })).toEqual({ field: "body_required" });
    expect(parseInfoPage({ ...ok, enTitle: "About" })).toEqual({ field: "english_incomplete" });
    expect(parseInfoPage({ ...ok, enBody: "Text" })).toEqual({ field: "english_incomplete" });
    const fa = parseInfoPage(ok);
    expect(fa).toMatchObject({ titles: { fa: "دربارهٔ ما", en: null } });
    const both = parseInfoPage({ ...ok, enTitle: "About us", enBody: "Text" });
    expect("document" in both && InfoPageDocument.parse(both.document).sections[0]?.props.content.en).toEqual([{ type: "paragraph", text: "Text" }]);
  });

  it("knows only the fixed page keys", () => {
    expect(isInfoPageKey("about")).toBe(true);
    expect(isInfoPageKey("toString")).toBe(false);
    expect(isInfoPageKey("../admin")).toBe(false);
  });

  it("rejects documents that are not the page shape", () => {
    expect(InfoPageDocument.safeParse({ version: 1, sections: [{ id: "body", type: "html", props: { html: "<b>x</b>" } }] }).success).toBe(false);
    expect(InfoPageDocument.safeParse({ version: 2, sections: [] }).success).toBe(false);
  });
});
