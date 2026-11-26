import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { categoryName, NameFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { createBrandAction } from "@/modules/catalog/api/catalog-actions";
import { listBrandsForAdmin } from "@/modules/catalog/service/brands";
import { adminPage } from "@/modules/identity/api/admin-page";

export default async function AdminBrandsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: brands } = await adminPage(locale, (actor) => listBrandsForAdmin(actor), "/admin/brands");
  const t = await getTranslations("AdminCatalog");
  const format = await getFormatter();

  return (
    <>
      <PageHeader title={t("brandsTitle")} description={t("brandsIntro")} testId="admin-brands-heading" />
      <Card>
        {brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("brandsEmpty")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-brands-list">
            {brands.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/brands/${b.id}`} className="flex h-full items-center justify-between gap-2 rounded-lg border p-3 hover:border-brand-orange" data-testid="admin-brand-row">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{categoryName(b, locale)}</span>
                    <span className="text-xs text-muted-foreground">{t("productCount", { count: format.number(b.productCount) })}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {b.isGenuine ? <Badge tone="orange">{t("genuine")}</Badge> : null}
                    {b.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("newBrand")} description={t("newBrandHelp")}>
        <ActionForm action={createBrandAction} submitLabel={t("create")} testId="admin-brand-create" namespace="AdminCatalog">
          <NameFields />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.sortOrder")} htmlFor="sortOrder" hint={t("fields.sortHint")}>
              <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue="0" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" name="isGenuine" />
              {t("fields.isGenuine")}
            </label>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
