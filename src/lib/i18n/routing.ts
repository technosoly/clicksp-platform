import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Every URL carries its locale (/fa/..., /en/...) for clean hreflang and caching.
  localePrefix: "always",
  // The store is Persian-first: "/" always goes to /fa, regardless of the
  // browser's Accept-Language. Visitors switch to English explicitly.
  localeDetection: false,
});
