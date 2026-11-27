import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { NameFields } from "@/components/admin/catalog-fields";
import { localName } from "@/components/admin/vehicle-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createManufacturerAction, createMotorcycleBrandAction } from "@/modules/vehicles/api/vehicle-actions";
import { listManufacturersForAdmin } from "@/modules/vehicles/service/motorcycles";

export default async function AdminMotorcyclesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: manufacturers } = await adminPage(locale, (actor) => listManufacturersForAdmin(actor), "/admin/motorcycles");
  const t = await getTranslations("AdminVehicles");

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-motorcycles-heading" />
      <Card>
        {manufacturers.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-motorcycles-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-4" data-testid="admin-motorcycles-list">
            {manufacturers.map((m) => (
              <li key={m.id} className="rounded-lg border p-3" data-testid="admin-manufacturer-row">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/motorcycles/manufacturers/${m.id}`} className="font-semibold hover:underline">
                    {localName(m.names, locale)}
                  </Link>
                  <span className="flex gap-1">
                    {m.countryCode ? <Badge>{m.countryCode}</Badge> : null}
                    {m.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                  </span>
                </div>
                {m.brands.length ? (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {m.brands.map((b) => (
                      <li key={b.id}>
                        <Link
                          href={`/admin/motorcycles/brands/${b.id}`}
                          className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:border-brand-orange"
                          data-testid="admin-motorcycle-brand-row"
                        >
                          <span className="font-medium">{localName(b.names, locale)}</span>
                          <span className="text-xs text-muted-foreground">{t("modelCount", { count: b.modelCount })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("newManufacturer")} description={t("newManufacturerHelp")}>
          <ActionForm action={createManufacturerAction} submitLabel={t("create")} testId="admin-manufacturer-create" namespace="AdminVehicles">
            <NameFields idPrefix="m-" />
            <Field label={t("fields.country")} htmlFor="countryCode" hint={t("fields.countryHint")}>
              <Input id="countryCode" name="countryCode" dir="ltr" maxLength={2} className="max-w-24" />
            </Field>
          </ActionForm>
        </Card>
        <Card title={t("newBrand")} description={t("newBrandHelp")}>
          {manufacturers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("needManufacturerFirst")}</p>
          ) : (
            <ActionForm action={createMotorcycleBrandAction} submitLabel={t("create")} testId="admin-motorcycle-brand-create" namespace="AdminVehicles">
              <Field label={t("fields.manufacturer")} htmlFor="manufacturerId">
                <select id="manufacturerId" name="manufacturerId" className={selectClass} required defaultValue={manufacturers.length === 1 ? manufacturers[0]!.id : ""}>
                  <option value="" disabled>
                    {t("choose")}
                  </option>
                  {manufacturers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {localName(m.names, locale)}
                    </option>
                  ))}
                </select>
              </Field>
              <NameFields idPrefix="b-" />
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
