import { isLocale } from "@/lib/i18n/config";

export const shopLocale = (locale: string): "fa" | "en" => (isLocale(locale) ? locale : "fa");

/** The slug from the URL, decoded; badly encoded input becomes "" (which finds nothing, so the page is a 404). */
export function slugParam(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return "";
  }
}
