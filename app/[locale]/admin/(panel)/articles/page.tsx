import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { articlesForAdmin } from "@/modules/content/service/articles";
import { adminPage } from "@/modules/identity/api/admin-page";

const TONE = { draft: "neutral", published: "success", archived: "orange" } as const;

export default async function AdminArticlesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string; deleted?: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const q = await searchParams;
  const { data } = await adminPage(raw, (actor) => articlesForAdmin(actor, Number(q.page ?? "1") || 1), "/admin/articles");
  const t = await getTranslations("AdminWebsite.articles");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-articles-heading"
        actions={
          <Link href="/admin/articles/new" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" data-testid="admin-article-new">
            {t("new")}
          </Link>
        }
      />
      {q.deleted ? (
        <p role="status" className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {t("deleted")}
        </p>
      ) : null}
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="admin-articles-list">
            {data.rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-article-row">
                <Link href={`/admin/articles/${a.id}`} className="font-semibold underline" lang="fa" dir="rtl">
                  {a.fa?.title ?? "–"}
                </Link>
                <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                {a.hasEnglish ? <span className="text-xs text-muted-foreground">EN</span> : null}
                <span className="ms-auto text-xs text-muted-foreground">
                  {t("updated", { date: formatDate(a.updatedAt, locale, { dateStyle: "medium" }), name: a.author })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.pages > 1 ? (
          <p className="mt-3 flex gap-3 text-sm">
            {data.page > 1 ? <Link href={`/admin/articles?page=${data.page - 1}`}>{t("previous")}</Link> : null}
            {data.page < data.pages ? <Link href={`/admin/articles?page=${data.page + 1}`}>{t("next")}</Link> : null}
          </p>
        ) : null}
      </Card>
    </>
  );
}
