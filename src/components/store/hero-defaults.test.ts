import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fa from "../../../messages/fa.json";
import { DEFAULT_HERO_SLIDES, defaultHeroSlides } from "./hero-defaults";

const translator = (messages: typeof fa) => (key: string) => {
  const [slide, field] = key.split(".") as [keyof typeof messages.Home.slider.defaults, "eyebrow" | "title" | "subtitle" | "cta"];
  return messages.Home.slider.defaults[slide][field];
};

describe("default home slides", () => {
  it.each([
    ["fa", fa],
    ["en", en],
  ] as const)("has complete %s text for every built-in slide", (locale, messages) => {
    const slides = defaultHeroSlides(translator(messages), locale);
    expect(slides).toHaveLength(DEFAULT_HERO_SLIDES.length);
    for (const s of slides) {
      expect(s.kind).toBe("brand");
      expect(s.lang).toBe(locale);
      for (const text of [s.eyebrow, s.title, s.subtitle, s.ctaLabel]) expect(text?.trim()).toBeTruthy();
    }
    expect(new Set(slides.map((s) => s.id)).size).toBe(slides.length);
  });

  it("links only to store pages, never outside the site", () => {
    for (const s of defaultHeroSlides(() => "x", "fa")) {
      expect(s.href).toEqual({ kind: "internal", path: expect.stringMatching(/^\/[a-z]+$/) });
    }
  });
});
