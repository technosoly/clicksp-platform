"use client";

import { useLocale, useTranslations } from "next-intl";
import { locales } from "@/lib/i18n/config";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";

/** Switches between /fa and /en while keeping the current page. */
export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const pathname = usePathname();
  const current = useLocale();

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 text-sm">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          hrefLang={locale}
          lang={locale}
          aria-current={locale === current ? "true" : undefined}
          data-testid={`lang-${locale}`}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors",
            locale === current ? "bg-secondary text-secondary-foreground" : "hover:bg-accent",
          )}
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
