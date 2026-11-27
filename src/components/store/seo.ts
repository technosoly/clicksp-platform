import type { Metadata } from "next";

/** Canonical URL in this locale and hreflang links for the locales that have a slug. */
export function alternatesFor(locale: "fa" | "en", prefix: string, slugs: Partial<Record<"fa" | "en", string>>): Metadata["alternates"] {
  const own = slugs[locale] ?? slugs.fa;
  const languages: Record<string, string> = {};
  for (const l of ["fa", "en"] as const) {
    const s = slugs[l] ?? slugs.fa;
    if (s) languages[l] = `/${l}/${prefix}/${encodeURIComponent(s)}`;
  }
  if (languages.fa) languages["x-default"] = languages.fa;
  return { canonical: own ? `/${locale}/${prefix}/${encodeURIComponent(own)}` : undefined, languages };
}
