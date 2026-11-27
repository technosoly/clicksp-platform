import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { Link } from "@/lib/i18n/navigation";
import { createArticleAction } from "@/modules/content/api/content-actions";
import { articlesForAdmin } from "@/modules/content/service/articles";
import { adminPage } from "@/modules/identity/api/admin-page";
import { ArticleFields, EMPTY_ARTICLE } from "../article-fields";

export default async function AdminNewArticlePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  // Opens only for people who may manage articles.
  const { data } = await adminPage(raw, (actor) => articlesForAdmin(actor, 1), "/admin/articles/new");
  const t = await getTranslations("AdminWebsite.articles");
  return (
    <>
      <PageHeader title={t("new")} description={t("formatHelp")} testId="admin-article-new-heading" actions={<Link href="/admin/articles" className="text-sm underline">{t("back")}</Link>} />
      <Card>
        <ActionForm action={createArticleAction} submitLabel={t("create")} testId="admin-article-create" namespace="AdminWebsite">
          <ArticleFields values={EMPTY_ARTICLE} canPublish={data.canPublish} />
        </ActionForm>
      </Card>
    </>
  );
}
