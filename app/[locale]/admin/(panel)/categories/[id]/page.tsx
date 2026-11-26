import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { CategoryOptions, categoryName, NameFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { updateCategoryAction } from "@/modules/catalog/api/catalog-actions";
import { getCategoryForAdmin } from "@/modules/catalog/service/categories";
import { adminPage } from "@/modules/identity/api/admin-page";

export default async function AdminCategoryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => getCategoryForAdmin(actor, id), `/admin/categories/${id}`);
  if (!data) notFound();
  const { category, parents, canMakeRoot } = data;
  const t = await getTranslations("AdminCatalog");

  return (
    <>
      <PageHeader title={categoryName(category, locale)} description={t("categoryEditIntro")} testId="admin-category-heading" />
      <Card>
        <ActionForm action={updateCategoryAction} submitLabel={t("save")} testId="admin-category-edit" namespace="AdminCatalog">
          <input type="hidden" name="categoryId" value={category.id} />
          <NameFields names={category.names} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.parent")} htmlFor="parentId">
              <select id="parentId" name="parentId" className={selectClass} defaultValue={category.parentId ?? ""}>
                {canMakeRoot || category.parentId === null ? <option value="">{t("topLevel")}</option> : null}
                <CategoryOptions categories={parents} locale={locale} inactiveLabel={t("inactive")} />
              </select>
            </Field>
            <Field label={t("fields.sortOrder")} htmlFor="sortOrder" hint={t("fields.sortHint")}>
              <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(category.sortOrder)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isActive" defaultChecked={category.isActive} />
              {t("fields.isActive")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isVehicleSystem" defaultChecked={category.isVehicleSystem} />
              {t("fields.isVehicleSystem")}
            </label>
          </div>
        </ActionForm>
      </Card>
      <Link href="/admin/categories" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToCategories")}
      </Link>
    </>
  );
}
