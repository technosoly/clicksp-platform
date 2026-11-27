import { getTranslations } from "next-intl/server";
import { Field, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { ARTICLE_LIMITS, ARTICLE_STATUSES } from "@/modules/content/domain/article";
import { LIMITS } from "@/modules/content/domain/info-page";

const area = "w-full rounded-md border border-input bg-background p-2 text-base leading-7";

export type ArticleValues = { status: string; faTitle: string; faSlug: string; faExcerpt: string; faBody: string; enTitle: string; enSlug: string; enExcerpt: string; enBody: string };
export const EMPTY_ARTICLE: ArticleValues = { status: "draft", faTitle: "", faSlug: "", faExcerpt: "", faBody: "", enTitle: "", enSlug: "", enExcerpt: "", enBody: "" };

/** The article form's fields (Persian, optional English, status). */
export async function ArticleFields({ values, canPublish }: { values: ArticleValues; canPublish: boolean }) {
  const t = await getTranslations("AdminWebsite.articles");
  return (
    <>
      <Field label={t("fields.status")} htmlFor="article-status">
        <select id="article-status" name="status" className={selectClass} defaultValue={values.status}>
          {ARTICLE_STATUSES.filter((s) => canPublish || s === "draft").map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </Field>
      {canPublish ? null : <p className="text-xs text-muted-foreground">{t("draftOnly")}</p>}
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">{t("persian")}</legend>
        <Field label={t("fields.title")} htmlFor="article-fa-title">
          <Input id="article-fa-title" name="faTitle" dir="rtl" required maxLength={ARTICLE_LIMITS.title} defaultValue={values.faTitle} />
        </Field>
        <Field label={t("fields.slug")} htmlFor="article-fa-slug" hint={t("fields.slugHint")}>
          <Input id="article-fa-slug" name="faSlug" dir="rtl" maxLength={ARTICLE_LIMITS.slug} defaultValue={values.faSlug} />
        </Field>
        <Field label={t("fields.excerpt")} htmlFor="article-fa-excerpt">
          <textarea id="article-fa-excerpt" name="faExcerpt" dir="rtl" rows={2} maxLength={ARTICLE_LIMITS.excerpt} defaultValue={values.faExcerpt} className={area} />
        </Field>
        <Field label={t("fields.body")} htmlFor="article-fa-body" hint={t("fields.bodyHint")}>
          <textarea id="article-fa-body" name="faBody" dir="rtl" required rows={16} maxLength={LIMITS.body} defaultValue={values.faBody} className={area} />
        </Field>
      </fieldset>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">{t("english")}</legend>
        <p className="text-xs text-muted-foreground">{t("englishHint")}</p>
        <Field label={t("fields.title")} htmlFor="article-en-title">
          <Input id="article-en-title" name="enTitle" dir="ltr" maxLength={ARTICLE_LIMITS.title} defaultValue={values.enTitle} />
        </Field>
        <Field label={t("fields.slug")} htmlFor="article-en-slug" hint={t("fields.slugHint")}>
          <Input id="article-en-slug" name="enSlug" dir="ltr" maxLength={ARTICLE_LIMITS.slug} defaultValue={values.enSlug} />
        </Field>
        <Field label={t("fields.excerpt")} htmlFor="article-en-excerpt">
          <textarea id="article-en-excerpt" name="enExcerpt" dir="ltr" rows={2} maxLength={ARTICLE_LIMITS.excerpt} defaultValue={values.enExcerpt} className={area} />
        </Field>
        <Field label={t("fields.body")} htmlFor="article-en-body">
          <textarea id="article-en-body" name="enBody" dir="ltr" rows={10} maxLength={LIMITS.body} defaultValue={values.enBody} className={area} />
        </Field>
      </fieldset>
    </>
  );
}
