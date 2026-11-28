import "server-only";
import { getTranslations } from "next-intl/server";
import { pick, pickWithLang, SOCIAL_NETWORKS, type SocialNetwork } from "@/modules/settings/domain/site-appearance";
import { shopSiteAppearance } from "@/modules/settings/service/site-appearance";
import { parseHref, type SafeHref } from "@/modules/content/domain/links";

export type SiteWording = {
  name: string;
  tagline: string;
  seoTitle: string;
  seoDescription: string;
  footerNote: { text: string; lang?: "fa" } | null;
  social: { network: SocialNetwork; url: string }[];
  announcement: { text: string; lang?: "fa"; href: SafeHref | null; tone: "orange" | "charcoal" | "light" } | null;
};

/** The storefront's name and wording in this language: what the owner saved in Site settings, else the built-in messages. */
export async function siteWording(locale: "fa" | "en"): Promise<SiteWording> {
  const [s, meta, common] = await Promise.all([
    shopSiteAppearance(),
    getTranslations({ locale, namespace: "Metadata" }),
    getTranslations({ locale, namespace: "Common" }),
  ]);
  const text = s.announcement.enabled ? pickWithLang(s.announcement.text, locale) : null;
  return {
    name: pick(s.name, locale) ?? meta("siteName"),
    tagline: pick(s.tagline, locale) ?? common("brandTagline"),
    seoTitle: pick(s.seoTitle, locale) ?? meta("title"),
    seoDescription: pick(s.seoDescription, locale) ?? meta("description"),
    footerNote: pickWithLang(s.footerNote, locale),
    social: SOCIAL_NETWORKS.filter((n) => s.social[n]).map((network) => ({ network, url: s.social[network] })),
    announcement: text ? { ...text, href: s.announcement.href ? parseHref(s.announcement.href) : null, tone: s.announcement.tone } : null,
  };
}
