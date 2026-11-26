import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { ProductDetailsFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { createProductAction } from "@/modules/catalog/api/catalog-actions";
import { brandOptions } from "@/modules/catalog/service/brands";
import { categoryOptions } from "@/modules/catalog/service/categories";
import { adminPage } from "@/modules/identity/api/admin-page";
import { authorizeAny } from "@/modules/rbac/service/authorize";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export default async function AdminNewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data, actor } = await adminPage(
    locale,
    async (actor) => {
      await authorizeAny(actor, ["product.create"], "products.new");
      return { categories: await categoryOptions(actor, "product.create"), brands: await brandOptions(actor), unit: await getDisplayUnit() };
    },
    "/admin/products/new",
  );
  const t = await getTranslations("AdminCatalog");
  const canPrice = actor.permissions.has("price.update") || actor.permissions.has("price.update.propose");
  const direct = actor.permissions.has("price.update");

  return (
    <>
      <PageHeader title={t("newProduct")} description={t("newProductIntro")} testId="admin-product-new-heading" />
      {data.categories.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground" data-testid="admin-product-no-categories">
            {t("needCategoryFirst")}
          </p>
        </Card>
      ) : (
        <Card>
          <ActionForm action={createProductAction} submitLabel={t("createProduct")} testId="admin-product-create" namespace="AdminCatalog">
            <ProductDetailsFields categories={data.categories} brands={data.brands} locale={locale} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("fields.sku")} htmlFor="sku" hint={t("fields.skuHint")}>
                <Input id="sku" name="sku" required dir="ltr" maxLength={64} autoCapitalize="characters" spellCheck={false} />
              </Field>
              {canPrice ? (
                <>
                  <Field label={t("fields.priceIn", { unit: t(`units.${data.unit}`) })} htmlFor="price" hint={direct ? t("fields.priceHint") : t("fields.priceProposeHint")}>
                    <Input id="price" name="price" inputMode="decimal" dir="ltr" />
                  </Field>
                  <Field label={t("fields.compareAtIn", { unit: t(`units.${data.unit}`) })} htmlFor="compareAtPrice" hint={t("fields.compareAtHint")}>
                    <Input id="compareAtPrice" name="compareAtPrice" inputMode="decimal" dir="ltr" />
                  </Field>
                </>
              ) : (
                <>
                  <input type="hidden" name="price" value="" />
                  <input type="hidden" name="compareAtPrice" value="" />
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("draftNote")}</p>
          </ActionForm>
        </Card>
      )}
      <Link href="/admin/products" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToProducts")}
      </Link>
    </>
  );
}
