import { normalizeForStorage } from "@/lib/persian-text";
import { hrefText, parseHref } from "./links";

/**
 * Promotional banners: a picture for wide screens (and optionally one for
 * phones), a Persian title and picture description, optional English, an
 * optional link and an optional time window (Tehran days).
 */

export const BANNER_PLACEMENTS = ["home_hero"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];
export const BANNER_LIMITS = { title: 200, subtitle: 300, cta: 60, alt: 300 } as const;

export type BannerTextInput = {
  faTitle: string;
  faSubtitle: string;
  faCta: string;
  faAlt: string;
  enTitle: string;
  enSubtitle: string;
  enCta: string;
  enAlt: string;
  href: string;
  sortOrder: string;
  isActive: boolean;
  startsOn: string;
  endsOn: string;
};

export type BannerLanguage = { title: string; subtitle: string | null; ctaLabel: string | null; alt: string };
export type BannerParsed = {
  fa: BannerLanguage;
  en: BannerLanguage | null;
  href: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

const UNSAFE = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;
const text = (s: string) => normalizeForStorage(s.replace(UNSAFE, "")).replace(/\s+/g, " ").trim();

/** YYYY-MM-DD as the start of that day in Tehran (UTC+03:30, no daylight saving since 2022). */
export function tehranDayStart(input: string): Date | null {
  const v = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00+03:30`);
  return Number.isNaN(d.getTime()) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v ? null : d;
}

function language(lang: "fa" | "en", input: { title: string; subtitle: string; cta: string; alt: string }): BannerLanguage | { field: string } {
  const title = text(input.title);
  if (!title) return { field: `${lang}_title_required` };
  const subtitle = text(input.subtitle);
  const cta = text(input.cta);
  const alt = text(input.alt) || title;
  if (title.length > BANNER_LIMITS.title || subtitle.length > BANNER_LIMITS.subtitle || cta.length > BANNER_LIMITS.cta || alt.length > BANNER_LIMITS.alt) return { field: "text_too_long" };
  return { title, subtitle: subtitle || null, ctaLabel: cta || null, alt };
}

export function parseBanner(input: BannerTextInput): BannerParsed | { field: string } {
  const fa = language("fa", { title: input.faTitle, subtitle: input.faSubtitle, cta: input.faCta, alt: input.faAlt });
  if ("field" in fa) return fa;
  const anyEnglish = [input.enTitle, input.enSubtitle, input.enCta, input.enAlt].some((v) => v.trim() !== "");
  const en = anyEnglish ? language("en", { title: input.enTitle, subtitle: input.enSubtitle, cta: input.enCta, alt: input.enAlt }) : null;
  if (en && "field" in en) return en;
  let href: string | null = null;
  if (input.href.trim()) {
    const parsed = parseHref(input.href);
    if (!parsed) return { field: "invalid_link" };
    href = hrefText(parsed);
  }
  if ((fa.ctaLabel || en?.ctaLabel) && !href) return { field: "cta_needs_link" };
  const sortOrder = input.sortOrder.trim() === "" ? 0 : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) return { field: "invalid_order" };
  const startsAt = input.startsOn.trim() ? tehranDayStart(input.startsOn) : null;
  const endDay = input.endsOn.trim() ? tehranDayStart(input.endsOn) : null;
  if ((input.startsOn.trim() && !startsAt) || (input.endsOn.trim() && !endDay)) return { field: "invalid_date" };
  // The last day is shown in full: the window ends at the start of the next day.
  const endsAt = endDay ? new Date(endDay.getTime() + 24 * 60 * 60_000) : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { field: "end_before_start" };
  return { fa, en, href, sortOrder, isActive: input.isActive, startsAt, endsAt };
}

/** Whether a banner shows at a moment. */
export const bannerLive = (b: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date) =>
  b.isActive && (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt > now);
