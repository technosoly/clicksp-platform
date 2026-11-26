import { intlLocale, type Locale } from "./config";

/**
 * Date presentation. Persian uses the Jalali (Persian) calendar, English uses
 * the Gregorian calendar. Dates are always stored as UTC timestamps; this is
 * display only, in the store's time zone.
 */
export function formatDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  calendar: "default" | "jalali" | "gregorian" = "default",
): string {
  const cal =
    calendar === "default" ? (locale === "fa" ? "persian" : "gregory") : calendar === "jalali" ? "persian" : "gregory";
  const tag = `${intlLocale[locale]}-u-ca-${cal}`;
  return new Intl.DateTimeFormat(tag, { timeZone: "Asia/Tehran", ...options }).format(date);
}
