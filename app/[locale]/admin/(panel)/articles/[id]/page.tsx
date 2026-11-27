import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { PictureCard } from "@/components/admin/picture-card";
import { Link } from "@/lib/i18n/navigation";
import {
  articleCoverAction,
  deleteArticleAction,
  saveArticleAction,
} from "@/modules/content/api/content-actions";
import { articleForAdmin } from "@/modules/content/service/articles";
import { adminPage } from "@/modules/identity/api/admin-page";
import { ArticleFields } from "../article-fields";

export default async function AdminArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const { data: article, actor } = await adminPage(
    raw,
    (actor) => articleForAdmin(actor, id),
    `/admin/articles/${id}`,
  );
  if (!article) notFound();
  const t = await getTranslations("AdminWebsite.articles");
  const created = (await searchParams).created;
  const viewSlug =
    raw === "en" && article.enSlug ? article.enSlug : article.faSlug;
  return (
    <>
      <PageHeader
        title={article.faTitle}
        description={t(`status.${article.status}`)}
        testId="admin-article-heading"
        actions={
          <span className="flex gap-3 text-sm">
            {article.status === "published" ? (
              <Link
                href={`/blog/${viewSlug}`}
                className="underline"
                data-testid="admin-article-view"
              >
                {t("view")}
              </Link>
            ) : null}
            <Link href="/admin/articles" className="underline">
              {t("back")}
            </Link>
          </span>
        }
      />
      {created ? (
        <p
          role="status"
          className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success"
          data-testid="admin-article-created"
        >
          {t("createdNotice")}
        </p>
      ) : null}
      {article.canEdit ? (
        <Card description={t("formatHelp")}>
          <ActionForm
            action={saveArticleAction}
            submitLabel={t("save")}
            testId="admin-article-form"
            namespace="AdminWebsite"
          >
            <input type="hidden" name="articleId" value={article.id} />
            <ArticleFields values={article} canPublish={article.canPublish} />
          </ActionForm>
        </Card>
      ) : (
        <Card>
          <p
            className="text-sm text-muted-foreground"
            data-testid="admin-article-locked"
          >
            {t("lockedForStaff")}
          </p>
        </Card>
      )}
      {article.canPublish ? (
        <>
          <div className="mt-4">
            <PictureCard
              title={t("cover")}
              help={t("coverHelp")}
              renditions={article.cover}
              alt={article.faTitle}
              action={articleCoverAction}
              hidden={{ name: "articleId", value: article.id }}
              canEdit={actor.permissions.has("media.upload")}
              testId="admin-article-cover"
            />
          </div>
          <Card
            title={t("deleteTitle")}
            description={t("deleteHelp")}
            className="mt-4"
          >
            <ActionForm
              action={deleteArticleAction}
              submitLabel={t("delete")}
              submitVariant="destructive"
              testId="admin-article-delete"
              namespace="AdminWebsite"
            >
              <input type="hidden" name="articleId" value={article.id} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" />{" "}
                {t("deleteConfirm")}
              </label>
            </ActionForm>
          </Card>
        </>
      ) : null}
    </>
  );
}
