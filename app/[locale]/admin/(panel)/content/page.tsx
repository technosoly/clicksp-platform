import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { infoPagesForAdmin } from "@/modules/content/service/info-pages";

export default async function AdminContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data: pages } = await adminPage(raw, (actor) => infoPagesForAdmin(actor), "/admin/content");
  const t = await getTranslations("AdminContent");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-content-heading" />
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
    </>
  );
}
