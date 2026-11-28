import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { infoPagesForAdmin } from "@/modules/content/service/info-pages";
import { holds } from "@/modules/rbac/domain/authorize";

/** Each visible part of the storefront and the screen that edits it, with the permission that opens it. */
const SITE_PARTS = [
  { key: "home", href: "/admin/page-builder", permission: "pagebuilder.edit" },
  { key: "slider", href: "/admin/banners", permission: "banner.manage" },
  { key: "menus", href: "/admin/menus", permission: "menu.manage" },
  { key: "site", href: "/admin/settings", permission: "settings.store" },
  { key: "contact", href: "/admin/content/contact", permission: "settings.store" },
  { key: "pages", href: "#info-pages", permission: "content.manage" },
  { key: "articles", href: "/admin/articles", permission: "article.manage" },
] as const;

export default async function AdminContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data: pages, ctx } = await adminPage(raw, (actor) => infoPagesForAdmin(actor), "/admin/content");
  const t = await getTranslations("AdminContent");
  const parts = SITE_PARTS.filter((p) => holds(ctx.permissions, p.permission));
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-content-heading" />
      <Card title={t("mapTitle")} description={t("mapHelp")} testId="admin-site-map">
        <ul className="grid gap-2 sm:grid-cols-2">
          {parts.map((p) => (
            <li key={p.key}>
              {p.href.startsWith("#") ? (
                <a href={p.href} className="block h-full rounded-lg border p-3 hover:border-brand-orange hover:bg-accent/50">
                  <span className="block font-medium">{t(`parts.${p.key}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`parts.${p.key}.help`)}</span>
                </a>
              ) : (
                <Link href={p.href} className="block h-full rounded-lg border p-3 hover:border-brand-orange hover:bg-accent/50" data-testid={`admin-site-part-${p.key}`}>
                  <span className="block font-medium">{t(`parts.${p.key}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`parts.${p.key}.help`)}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div id="info-pages" className="scroll-mt-4" />
      <Card title={t("pagesTitle")} description={t("pagesHelp")} testId="admin-info-pages">
        <ul className="divide-y">
          {pages.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-info-page-row">
              <Link href={`/admin/content/pages/${p.key}`} className="font-medium hover:underline">
                {t(`keys.${p.key}`)}
              </Link>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {p.published && p.publishedAt ? <span>{t("publishedAt", { time: formatDate(p.publishedAt, locale, { dateStyle: "medium" }) })}</span> : null}
                {p.published ? (p.hasEnglish ? null : <Badge>{t("noEnglish")}</Badge>) : <Badge tone="orange">{t("notWritten")}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("contactTitle")} description={t("contactHelp")} testId="admin-contact-card">
        <Link href="/admin/content/contact" className="font-medium underline" data-testid="admin-contact-edit">
          {t("contactEdit")}
        </Link>
      </Card>
    </>
  );
}
