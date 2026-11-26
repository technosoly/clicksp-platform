/**
 * Locale configuration shared by server and client code.
 * Persian (fa) is the default; English (en) is secondary.
 */
export const locales = ["fa", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fa";

export const localeDirection: Record<Locale, "rtl" | "ltr"> = {
  fa: "rtl",
  en: "ltr",
};

/** BCP 47 tags used for Intl formatting (numbers, dates). */
export const intlLocale: Record<Locale, string> = {
  fa: "fa-IR",
  en: "en-US",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
