import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { categoryName, NameFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { PictureCard } from "@/components/admin/picture-card";
import { brandLogoAction, updateBrandAction } from "@/modules/catalog/api/catalog-actions";
import { getBrandForAdmin } from "@/modules/catalog/service/brands";
import { adminPage } from "@/modules/identity/api/admin-page";

export default async function AdminBrandPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data: brand } = await adminPage(locale, (actor) => getBrandForAdmin(actor, id), `/admin/brands/${id}`);
  if (!brand) notFound();
  const t = await getTranslations("AdminCatalog");
  return (
    <>
      <PageHeader title={categoryName(brand, locale)} description={t("brandEditIntro")} testId="admin-brand-heading" />
      <Card>
        <ActionForm action={updateBrandAction} submitLabel={t("save")} testId="admin-brand-edit" namespace="AdminCatalog">
          <input type="hidden" name="brandId" value={brand.id} />
          <NameFields names={brand.names} />
          <Field label={t("fields.sortOrder")} htmlFor="sortOrder" hint={t("fields.sortHint")}>
            <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(brand.sortOrder)} className="max-w-40" />
          </Field>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isActive" defaultChecked={brand.isActive} />
              {t("fields.isActive")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isGenuine" defaultChecked={brand.isGenuine} />
              {t("fields.isGenuine")}
            </label>
          </div>
        </ActionForm>
      </Card>
      <PictureCard
        title={t("brandLogoTitle")}
        help={t("brandLogoHelp")}
        renditions={brand.logo}
        alt={categoryName(brand, locale)}
        action={brandLogoAction}
        hidden={{ name: "brandId", value: brand.id }}
        canEdit={brand.canSetLogo}
        testId="admin-brand-logo"
      />
      <Link href="/admin/brands" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToBrands")}
      </Link>
    </>
  );
}
