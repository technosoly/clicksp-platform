import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { LIMITS } from "@/modules/content/domain/info-page";
import { saveInfoPageAction } from "@/modules/content/api/info-page-actions";
import { infoPageForAdmin } from "@/modules/content/service/info-pages";
import { adminPage } from "@/modules/identity/api/admin-page";

const area = "w-full rounded-md border border-input bg-background p-2 text-base leading-7";

export default async function AdminInfoPageEditor({ params }: { params: Promise<{ locale: string; key: string }> }) {
  const { locale: raw, key } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data: page } = await adminPage(raw, (actor) => infoPageForAdmin(actor, key), `/admin/content/pages/${key}`);
  if (!page) notFound();
  const t = await getTranslations("AdminContent");
  return (
    <>
      <PageHeader
        title={t(`keys.${page.key}`)}
        description={page.revisionNo ? t("revision", { number: formatCount(page.revisionNo, locale) }) : t("notWrittenIntro")}
        testId="admin-info-page-heading"
        actions={
          <span className="flex gap-3 text-sm">
            {page.revisionNo ? (
              <Link href={`/pages/${page.key}`} className="underline" data-testid="admin-info-page-view">
                {t("view")}
              </Link>
            ) : null}
            <Link href="/admin/content" className="underline">
              {t("back")}
            </Link>
          </span>
        }
      />
      <Card description={t("formatHelp")}>
        <ActionForm action={saveInfoPageAction} submitLabel={t("publish")} testId="admin-info-page-form" namespace="AdminContent">
          <input type="hidden" name="key" value={page.key} />
          <Field label={t("fields.faTitle")} htmlFor="info-fa-title">
            <Input id="info-fa-title" name="faTitle" required maxLength={LIMITS.title} defaultValue={page.faTitle} />
          </Field>
          <Field label={t("fields.faBody")} htmlFor="info-fa-body">
            <textarea id="info-fa-body" name="faBody" dir="rtl" required maxLength={LIMITS.body} rows={16} defaultValue={page.faBody} className={area} />
          </Field>
          <Field label={t("fields.enTitle")} htmlFor="info-en-title" hint={t("fields.enHint")}>
            <Input id="info-en-title" name="enTitle" dir="ltr" maxLength={LIMITS.title} defaultValue={page.enTitle} />
          </Field>
          <Field label={t("fields.enBody")} htmlFor="info-en-body">
            <textarea id="info-en-body" name="enBody" dir="ltr" maxLength={LIMITS.body} rows={10} defaultValue={page.enBody} className={area} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
