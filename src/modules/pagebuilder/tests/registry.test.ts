import { describe, expect, it } from "vitest";
import { ALL_VISIBLE, DEFAULT_HOME, DOCUMENT_LIMITS, defaultProps, formValues, propsFromForm, readDocument, SECTION_TYPES, visibilityFromForm, type BuilderSection } from "../domain/registry";

const doc = (sections: unknown[]) => ({ version: 1, sections });
const callout = (props: Record<string, unknown>) => ({ id: "call0001", type: "callout", visibility: ALL_VISIBLE, props: { title: { fa: "عنوان" }, text: {}, cta: {}, tone: "orange", ...props } });

describe("page builder documents", () => {
  it("accepts the default home page and every type's default props", () => {
    expect(readDocument(DEFAULT_HOME)).toEqual(DEFAULT_HOME);
    const all = SECTION_TYPES.map((type, i) => ({ id: `sect${String(i).padStart(4, "0")}`, type, visibility: ALL_VISIBLE, props: defaultProps(type) }));
    expect(readDocument(doc(all))).not.toBeNull();
  });

  it("refuses unknown types, extra props, HTML-ish fields and bad links", () => {
    const bad: unknown[] = [
      doc([{ id: "html0001", type: "html", visibility: ALL_VISIBLE, props: { html: "<script>alert(1)</script>" } }]),
      doc([{ ...callout({}), props: { ...callout({}).props, style: "color:red" } }]),
      doc([{ ...callout({}), className: "x" }]),
      doc([callout({ href: "javascript:alert(1)" })]),
      doc([callout({ href: "data:text/html,<script>x</script>" })]),
      doc([callout({ href: "//evil.example" })]),
      doc([callout({ href: "http://example.ir" })]),
      doc([callout({ tone: "#ff0000" })]),
      doc([callout({ title: { fa: "" } })]),
      doc([callout({ title: { fa: "عنوان \u202Eمعکوس" } })]),
      doc([{ id: "rich0002", type: "richText", visibility: ALL_VISIBLE, props: { content: { fa: [{ type: "paragraph", text: "x\u2066y" }] } } }]),
      doc([{ ...callout({}), id: "A B" }]),
      doc([callout({}), callout({})]),
      doc([{ ...callout({}), visibility: { breakpoints: [], locales: ["fa"] } }]),
      doc([{ id: "rich0001", type: "richText", visibility: ALL_VISIBLE, props: { content: { fa: [{ type: "html", text: "<b>x</b>" }] } } }]),
      { version: 2, sections: [] },
      { version: 1, sections: [], script: "x" },
    ];
    for (const d of bad) expect(readDocument(d)).toBeNull();
  });

  it("refuses too many sections and oversize documents", () => {
    const many = Array.from({ length: DOCUMENT_LIMITS.sections + 1 }, (_, i) => ({ id: `many${String(i).padStart(4, "0")}`, type: "bannerSlider", visibility: ALL_VISIBLE, props: {} }));
    expect(readDocument(doc(many))).toBeNull();
    const paragraph = { type: "paragraph", text: "ب".repeat(4_900) };
    const big = Array.from({ length: 6 }, (_, i) => ({ id: `big${String(i).padStart(5, "0")}`, type: "richText", visibility: ALL_VISIBLE, props: { content: { fa: Array.from({ length: 6 }, () => paragraph) } } }));
    expect(readDocument(doc(big))).toBeNull();
  });
});

describe("editor forms", () => {
  const form = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? "", has: (n: string) => values[n] === "on" });

  it("reads a callout and round-trips through formValues", () => {
    const f = form({ "title.fa": " عنوان  تازه ", "text.fa": "متن", "cta.fa": "خرید", "cta.en": "Shop", href: "/fa/c/brakes", tone: "charcoal" });
    const r = propsFromForm("callout", f.get, f.has);
    expect(r).toEqual({ props: { title: { fa: "عنوان تازه" }, text: { fa: "متن" }, cta: { fa: "خرید", en: "Shop" }, href: "/c/brakes", tone: "charcoal" } });
    if (!("props" in r)) throw new Error("expected props");
    const section = { id: "call0001", type: "callout", visibility: ALL_VISIBLE, props: r.props } as BuilderSection;
    expect(formValues(section)).toMatchObject({ "title.fa": "عنوان تازه", "cta.en": "Shop", href: "/c/brakes", tone: "charcoal" });
  });

  it("names the field that is wrong", () => {
    const cases: [Record<string, string>, string][] = [
      [{ "title.fa": "", tone: "orange" }, "title_required"],
      [{ "title.fa": "x", "text.en": "only English", tone: "orange" }, "persian_first"],
      [{ "title.fa": "x", href: "javascript:alert(1)", tone: "orange" }, "invalid_link"],
      [{ "title.fa": "x", "cta.fa": "برو", tone: "orange" }, "cta_needs_link"],
      [{ "title.fa": "x", tone: "red" }, "invalid"],
      [{ "title.fa": "x".repeat(121), tone: "orange" }, "text_too_long"],
    ];
    for (const [values, field] of cases) {
      const f = form(values);
      expect(propsFromForm("callout", f.get, f.has)).toEqual({ field });
    }
    const n = form({ limit: "5" });
    expect(propsFromForm("motorcycles", n.get, n.has)).toEqual({ field: "invalid_number" });
    const ok = form({ limit: "24", showLogo: "on" });
    expect(propsFromForm("motorcycles", ok.get, ok.has)).toEqual({ props: { heading: {}, limit: 24 } });
  });

  it("text written into rich text stays text", () => {
    const f = form({ "content.fa": "<script>alert(1)</script>\n\n## تیتر" });
    const r = propsFromForm("richText", f.get, f.has);
    expect(r).toEqual({ props: { content: { fa: [{ type: "paragraph", text: "<script>alert(1)</script>" }, { type: "heading", text: "تیتر" }] } } });
  });

  it("needs at least one screen size and one language", () => {
    expect(visibilityFromForm((n) => n === "show.mobile")).toEqual({ field: "visibility_required" });
    expect(visibilityFromForm((n) => ["show.mobile", "show.en"].includes(n))).toEqual({ breakpoints: ["mobile"], locales: ["en"] });
  });
});
