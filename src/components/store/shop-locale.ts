import { isLocale } from "@/lib/i18n/config";

export const shopLocale = (locale: string): "fa" | "en" => (isLocale(locale) ? locale : "fa");
