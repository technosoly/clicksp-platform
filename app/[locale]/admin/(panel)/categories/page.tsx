import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { CategoryOptions, categoryName, NameFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { createCategoryAction } from "@/modules/catalog/api/catalog-actions";
import { listCategoriesForAdmin } from "@/modules/catalog/service/categories";
import { adminPage } from "@/modules/identity/api/admin-page";

export default async function AdminCategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => listCategoriesForAdmin(actor), "/admin/categories");
  const t = await getTranslations("AdminCatalog");
  const format = await getFormatter();
  const parents = data.rows.filter((r) => r.editable);

  return (
    <>
      <PageHeader title={t("categoriesTitle")} description={t("categoriesIntro")} testId="admin-categories-heading" />
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-categories-empty">
            {t("categoriesEmpty")}
          </p>
        ) : (
          <ul className="divide-y" data-testid="admin-categories-list">
            {data.rows.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2" style={{ paddingInlineStart: `${c.depth * 1.25}rem` }}>
                <span className="flex min-w-0 items-center gap-2">
                  {c.editable ? (
                    <Link href={`/admin/categories/${c.id}`} className="truncate font-medium hover:text-brand-orange-strong" data-testid="admin-category-row">
                      {categoryName(c, locale)}
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{categoryName(c, locale)}</span>
                  )}
                  {c.isVehicleSystem ? <Badge tone="brand">{t("vehicleSystem")}</Badge> : null}
                  {c.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                  {c.names.en ? null : <Badge>{t("missingEnglish")}</Badge>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("productCount", { count: format.number(c.productCount) })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.canCreateRoot || parents.length > 0 ? (
        <Card title={t("newCategory")} description={t("newCategoryHelp")}>
          <ActionForm action={createCategoryAction} submitLabel={t("create")} testId="admin-category-create" namespace="AdminCatalog">
            <NameFields />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("fields.parent")} htmlFor="parentId">
                <select id="parentId" name="parentId" className={selectClass} defaultValue={data.canCreateRoot ? "" : parents[0]?.id}>
                  {data.canCreateRoot ? <option value="">{t("topLevel")}</option> : null}
                  <CategoryOptions categories={parents} locale={locale} inactiveLabel={t("inactive")} />
                </select>
              </Field>
              <Field label={t("fields.sortOrder")} htmlFor="sortOrder" hint={t("fields.sortHint")}>
                <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue="0" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-3 text-sm">
                <input type="checkbox" name="isVehicleSystem" />
                {t("fields.isVehicleSystem")}
              </label>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
