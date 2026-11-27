import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { NameFields } from "@/components/admin/catalog-fields";
import { localName } from "@/components/admin/vehicle-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { updateManufacturerAction } from "@/modules/vehicles/api/vehicle-actions";
import { getManufacturerForAdmin } from "@/modules/vehicles/service/motorcycles";

export default async function AdminManufacturerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data: m } = await adminPage(locale, (actor) => getManufacturerForAdmin(actor, id), `/admin/motorcycles/manufacturers/${id}`);
  if (!m) notFound();
  const t = await getTranslations("AdminVehicles");
  return (
    <>
      <PageHeader title={localName(m.names, locale)} description={t("manufacturerEditIntro")} testId="admin-manufacturer-heading" />
      <Card>
        <ActionForm action={updateManufacturerAction} submitLabel={t("save")} testId="admin-manufacturer-edit" namespace="AdminVehicles">
          <input type="hidden" name="manufacturerId" value={m.id} />
          <NameFields names={m.names} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.country")} htmlFor="countryCode" hint={t("fields.countryHint")}>
              <Input id="countryCode" name="countryCode" dir="ltr" maxLength={2} defaultValue={m.countryCode ?? ""} className="max-w-24" />
            </Field>
            <Field label={t("fields.sortOrder")} htmlFor="sortOrder">
              <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(m.sortOrder)} className="max-w-40" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={m.isActive} />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>
      <Link href="/admin/motorcycles" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToMotorcycles")}
      </Link>
    </>
  );
}
