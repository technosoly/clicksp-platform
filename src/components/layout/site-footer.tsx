import { getLocale, getTranslations } from "next-intl/server";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { shopInfoPageLinks } from "@/modules/content/service/info-pages";
import { shopMenu } from "@/modules/content/service/menus";
import { MenuLink } from "./menu-link";

export async function SiteFooter() {
  const [t, meta, common, locale] = await Promise.all([getTranslations("Footer"), getTranslations("Metadata"), getTranslations("Common"), getLocale()]);
  const [links, menu] = await Promise.all([shopInfoPageLinks(shopLocale(locale)), shopMenu("footer", shopLocale(locale))]);
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-muted-foreground">
        <nav aria-label={t("pagesLabel")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="footer-pages">
            <li>
              <Link href="/blog" className="hover:text-foreground hover:underline" data-testid="footer-blog">
                {t("blog")}
              </Link>
            </li>
            {links.map((l) => (
              <li key={l.key}>
                <Link href={`/pages/${l.key}`} lang={l.lang} className="hover:text-foreground hover:underline">
                  {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {menu.length > 0 ? (
          <nav aria-label={t("moreLabel")}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="footer-menu">
              {menu.map((l, i) => (
                <li key={i}>
                  <MenuLink link={l} className="hover:text-foreground hover:underline" />
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
