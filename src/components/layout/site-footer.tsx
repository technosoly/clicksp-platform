import { getLocale, getTranslations } from "next-intl/server";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { shopInfoPageLinks } from "@/modules/content/service/info-pages";
import { shopMenu } from "@/modules/content/service/menus";
import { toFaDigits } from "@/lib/persian-text";
import { telHref } from "@/modules/settings/domain/contact-info";
import { shopContactInfo } from "@/modules/settings/service/contact-info";
import { MenuLink } from "./menu-link";
import type { SiteWording } from "./site-wording";

export async function SiteFooter({ site }: { site: SiteWording }) {
  const [t, locale] = await Promise.all([getTranslations("Footer"), getLocale()]);
  const [links, menu, contact] = await Promise.all([shopInfoPageLinks(shopLocale(locale)), shopMenu("footer", shopLocale(locale)), shopContactInfo()]);
  const digits = (v: string) => (locale === "fa" ? toFaDigits(v) : v);
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-muted-foreground">
        {site.footerNote ? (
          <p lang={site.footerNote.lang} className="max-w-3xl whitespace-pre-line leading-7" data-testid="footer-note">
            {site.footerNote.text}
          </p>
        ) : null}
        {contact.phones.length > 0 || contact.email || site.social.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="footer-reach">
            {contact.phones.map((p) => (
              <a key={p} href={telHref(p)} dir="ltr" className="hover:text-foreground hover:underline">
                {digits(p)}
              </a>
            ))}
            {contact.email ? (
              <a href={`mailto:${contact.email}`} dir="ltr" className="hover:text-foreground hover:underline">
                {contact.email}
              </a>
            ) : null}
            {site.social.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label={t("socialLabel")} data-testid="footer-social">
                {site.social.map((s) => (
                  <li key={s.network}>
                    <a href={s.url} rel="noopener noreferrer me" target="_blank" className="inline-flex min-h-9 items-center rounded-full border bg-background px-3 text-xs font-medium hover:text-foreground">
                      {t(`social.${s.network}`)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <nav aria-label={t("pagesLabel")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="footer-pages">
            <li>
              <Link href="/blog" className="hover:text-foreground hover:underline" data-testid="footer-blog">
                {t("blog")}
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-foreground hover:underline" data-testid="footer-about">
                {t("about")}
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-foreground hover:underline" data-testid="footer-contact">
                {t("contact")}
              </Link>
            </li>
            {links.filter((l) => l.key !== "about" && l.key !== "contact").map((l) => (
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
          <p data-testid="footer-tagline">{site.tagline}</p>
          <p>{t("rights", { name: site.name })}</p>
        </div>
      </div>
    </footer>
  );
}
