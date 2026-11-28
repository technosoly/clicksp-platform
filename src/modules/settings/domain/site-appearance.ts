import { z } from "zod";
import { normalizeForStorage } from "@/lib/persian-text";
import { hrefText, parseHref } from "@/modules/content/domain/links";

/**
 * The storefront's look-and-wording settings (store setting `store.site`,
 * edited with settings.store): the site name and tagline, the home page's
 * search-engine title and description, a short footer note, social links
 * and an announcement bar above the header.
 *
 * Every text field is optional. An empty field means "use the built-in
 * wording from the translation messages", so the site looks exactly as it
 * did before anything is saved. Nothing here is business data: it is
 * wording the owner types.
 *
 * Social links are https addresses on each network's own hosts only, so a
 * footer icon can never point somewhere else. The announcement link uses
 * the same rules as menus and banners (store path or https address).
 */

export const SITE_LIMITS = { name: 60, tagline: 120, seoTitle: 70, seoDescription: 200, footerNote: 400, announcement: 200, url: 300 } as const;

const UNSAFE = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;
const UNSAFE_MULTILINE = /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
const line = (s: string) => normalizeForStorage(s.replace(UNSAFE, " ")).replace(/\s+/g, " ").trim();
const block = (s: string) =>
  normalizeForStorage(s.replace(/\r\n?/g, "\n").replace(UNSAFE_MULTILINE, " "))
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Each network and the hosts its links may point at. */
export const SOCIAL_HOSTS = {
  instagram: ["instagram.com", "www.instagram.com"],
  telegram: ["t.me", "telegram.me"],
  whatsapp: ["wa.me", "api.whatsapp.com"],
  eitaa: ["eitaa.com", "www.eitaa.com"],
  bale: ["ble.ir"],
  rubika: ["rubika.ir", "www.rubika.ir"],
  aparat: ["aparat.com", "www.aparat.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
} as const;
export type SocialNetwork = keyof typeof SOCIAL_HOSTS;
export const SOCIAL_NETWORKS = Object.keys(SOCIAL_HOSTS) as SocialNetwork[];

export function isSocialLink(network: SocialNetwork, value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (SOCIAL_HOSTS[network] as readonly string[]).includes(url.hostname) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export const ANNOUNCEMENT_TONES = ["orange", "charcoal", "light"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

const Text = (max: number) => z.string().max(max);
const Social = (n: SocialNetwork) =>
  z
    .string()
    .max(SITE_LIMITS.url)
    .refine((v) => v === "" || isSocialLink(n, v));
const Pair = (max: number) => z.object({ fa: Text(max), en: Text(max) }).strict();

export const SiteAppearance = z
  .object({
    name: Pair(SITE_LIMITS.name),
    tagline: Pair(SITE_LIMITS.tagline),
    seoTitle: Pair(SITE_LIMITS.seoTitle),
    seoDescription: Pair(SITE_LIMITS.seoDescription),
    footerNote: Pair(SITE_LIMITS.footerNote),
    social: z
      .object({
        instagram: Social("instagram"),
        telegram: Social("telegram"),
        whatsapp: Social("whatsapp"),
        eitaa: Social("eitaa"),
        bale: Social("bale"),
        rubika: Social("rubika"),
        aparat: Social("aparat"),
        youtube: Social("youtube"),
      })
      .strict(),
    announcement: z
      .object({
        enabled: z.boolean(),
        text: Pair(SITE_LIMITS.announcement),
        href: z
          .string()
          .max(SITE_LIMITS.url)
          .refine((v) => v === "" || parseHref(v) !== null),
        tone: z.enum(ANNOUNCEMENT_TONES),
      })
      .strict(),
  })
  .strict();
export type SiteAppearance = z.infer<typeof SiteAppearance>;

const emptyPair = () => ({ fa: "", en: "" });
export const EMPTY_SITE: SiteAppearance = {
  name: emptyPair(),
  tagline: emptyPair(),
  seoTitle: emptyPair(),
  seoDescription: emptyPair(),
  footerNote: emptyPair(),
  social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, ""])) as Record<SocialNetwork, string>,
  announcement: { enabled: false, text: emptyPair(), href: "", tone: "orange" },
};

/** A stored value, or the empty settings when it is missing or no longer matches the schema. */
export function readSiteAppearance(value: unknown): SiteAppearance {
  const parsed = SiteAppearance.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_SITE;
}

export type SiteInput = {
  nameFa: string;
  nameEn: string;
  taglineFa: string;
  taglineEn: string;
  seoTitleFa: string;
  seoTitleEn: string;
  seoDescriptionFa: string;
  seoDescriptionEn: string;
  footerNoteFa: string;
  footerNoteEn: string;
  social: Record<SocialNetwork, string>;
  announcementEnabled: boolean;
  announcementFa: string;
  announcementEn: string;
  announcementHref: string;
  announcementTone: string;
};

type Field = "name" | "tagline" | "seoTitle" | "seoDescription" | "footerNote" | "announcement";

/** Validates an admin edit. Errors name the field that was wrong. */
export function parseSiteInput(input: SiteInput): { value: SiteAppearance } | { field: string } {
  const pairs: Record<Field, { fa: string; en: string }> = {
    name: { fa: line(input.nameFa), en: line(input.nameEn) },
    tagline: { fa: line(input.taglineFa), en: line(input.taglineEn) },
    seoTitle: { fa: line(input.seoTitleFa), en: line(input.seoTitleEn) },
    seoDescription: { fa: line(input.seoDescriptionFa), en: line(input.seoDescriptionEn) },
    footerNote: { fa: block(input.footerNoteFa), en: block(input.footerNoteEn) },
    announcement: { fa: line(input.announcementFa), en: line(input.announcementEn) },
  };
  for (const [field, pair] of Object.entries(pairs) as [Field, { fa: string; en: string }][]) {
    if (pair.fa.length > SITE_LIMITS[field] || pair.en.length > SITE_LIMITS[field]) return { field: `${field}_too_long` };
  }

  const social = {} as Record<SocialNetwork, string>;
  for (const n of SOCIAL_NETWORKS) {
    const v = (input.social[n] ?? "").trim();
    if (v && !isSocialLink(n, v)) return { field: `social_${n}_invalid` };
    social[n] = v ? new URL(v).toString() : "";
  }

  const rawHref = input.announcementHref.trim();
  const href = rawHref ? parseHref(rawHref) : null;
  if (rawHref && !href) return { field: "announcement_link_invalid" };
  if (!(ANNOUNCEMENT_TONES as readonly string[]).includes(input.announcementTone)) return { field: "invalid" };
  if (input.announcementEnabled && !pairs.announcement.fa) return { field: "announcement_fa_required" };

  const value: SiteAppearance = {
    name: pairs.name,
    tagline: pairs.tagline,
    seoTitle: pairs.seoTitle,
    seoDescription: pairs.seoDescription,
    footerNote: pairs.footerNote,
    social,
    announcement: {
      enabled: input.announcementEnabled,
      text: pairs.announcement,
      href: href ? hrefText(href) : "",
      tone: input.announcementTone as AnnouncementTone,
    },
  };
  const parsed = SiteAppearance.safeParse(value);
  return parsed.success ? { value: parsed.data } : { field: "invalid" };
}

/** Wording that has a built-in default (name, tagline, SEO): this language's field, or null to use the built-in wording. */
export function pick(pair: { fa: string; en: string }, locale: "fa" | "en"): string | null {
  return pair[locale] || null;
}

/** Wording with no built-in default (footer note, announcement): English when written, else the Persian text marked lang="fa". */
export function pickWithLang(pair: { fa: string; en: string }, locale: "fa" | "en"): { text: string; lang?: "fa" } | null {
  if (locale === "en" && pair.en) return { text: pair.en };
  if (pair.fa) return locale === "en" ? { text: pair.fa, lang: "fa" } : { text: pair.fa };
  return null;
}
