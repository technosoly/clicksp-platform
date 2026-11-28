import type { HeroBrandSlide } from "./hero-slider";

/**
 * The home slider's built-in slides, drawn in the brand colours. They show
 * only while no banner from the admin panel is live, so the slider is never
 * empty on a new store. Text comes from the Home.slider.defaults messages;
 * links go to store pages that always exist.
 */
export const DEFAULT_HERO_SLIDES = [
  { key: "parts", tone: "orange", path: "/search" },
  { key: "fitment", tone: "light", path: "/motorcycles" },
  { key: "guides", tone: "charcoal", path: "/blog" },
] as const;

type Translate = (key: `${(typeof DEFAULT_HERO_SLIDES)[number]["key"]}.${"eyebrow" | "title" | "subtitle" | "cta"}`) => string;

export function defaultHeroSlides(t: Translate, locale: "fa" | "en"): HeroBrandSlide[] {
  return DEFAULT_HERO_SLIDES.map((d) => ({
    kind: "brand",
    id: `default-${d.key}`,
    tone: d.tone,
    lang: locale,
    eyebrow: t(`${d.key}.eyebrow`),
    title: t(`${d.key}.title`),
    subtitle: t(`${d.key}.subtitle`),
    ctaLabel: t(`${d.key}.cta`),
    href: { kind: "internal", path: d.path },
  }));
}
