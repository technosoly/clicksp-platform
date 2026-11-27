import { getLocale, getTranslations } from "next-intl/server";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { shopInfoPageLinks } from "@/modules/content/service/info-pages";

export async function SiteFooter() {
  const [t, meta, common, locale] = await Promise.all([getTranslations("Footer"), getTranslations("Metadata"), getTranslations("Common"), getLocale()]);
  const links = await shopInfoPageLinks(shopLocale(locale));
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-muted-foreground">
        {links.length > 0 ? (
          <nav aria-label={t("pagesLabel")}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="footer-pages">
              {links.map((l) => (
                <li key={l.key}>
                  <Link href={`/pages/${l.key}`} lang={l.lang} className="hover:text-foreground hover:underline">
                    {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
          <p>{common("brandTagline")}</p>
          <p>{t("rights", { name: meta("siteName") })}</p>
        </div>
      </div>
    </footer>
  );
}
