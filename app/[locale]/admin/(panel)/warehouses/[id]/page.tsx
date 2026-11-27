import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createLocationAction, updateLocationAction, updateWarehouseAction } from "@/modules/inventory/api/inventory-actions";
import { getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
import { WarehouseFields } from "../fields";

export default async function AdminWarehousePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data: w } = await adminPage(locale, (actor) => getWarehouseForAdmin(actor, id), `/admin/warehouses/${id}`);
  if (!w) notFound();
  const t = await getTranslations("AdminInventory");
  const hidden = <input type="hidden" name="warehouseId" value={w.id} />;

  return (
    <>
      <PageHeader title={`${w.code} · ${w.name}`} description={t("warehouseEditIntro")} testId="admin-warehouse-heading" />
      <Card>
        <ActionForm action={updateWarehouseAction} submitLabel={t("save")} testId="admin-warehouse-edit" namespace="AdminInventory">
          {hidden}
          <WarehouseFields w={w} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={w.isActive} />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>

      <Card title={t("locationsTitle")} description={t("locationsHelp")} testId="admin-warehouse-locations">
        <ul className="divide-y">
          {w.locations.map((l) => (
            <li key={l.id} className="py-3" data-testid="admin-location-row">
              <ActionForm action={updateLocationAction} submitLabel={t("save")} submitVariant="outline" testId="admin-location-edit" namespace="AdminInventory">
                {hidden}
                <input type="hidden" name="locationId" value={l.id} />
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t("fields.code")} htmlFor={`code-${l.id}`}>
                    <Input id={`code-${l.id}`} name="code" dir="ltr" required maxLength={32} defaultValue={l.code} className="max-w-40 uppercase" />
                  </Field>
                  <Field label={t("fields.description")} htmlFor={`description-${l.id}`}>
                    <Input id={`description-${l.id}`} name="description" maxLength={200} defaultValue={l.description ?? ""} />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" name="isDefault" defaultChecked={l.isDefault} />
                    {t("fields.isDefault")}
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" name="isActive" defaultChecked={l.isActive} />
                    {t("fields.isActive")}
                  </label>
                  {l.isDefault ? <Badge tone="brand">{t("defaultLocation")}</Badge> : null}
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={createLocationAction} submitLabel={t("addLocation")} testId="admin-location-create" namespace="AdminInventory" className="mt-3 border-t pt-3">
          {hidden}
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("fields.code")} htmlFor="new-location-code" hint={t("fields.locationCodeHint")}>
              <Input id="new-location-code" name="code" dir="ltr" required maxLength={32} className="max-w-40 uppercase" />
            </Field>
            <Field label={t("fields.description")} htmlFor="new-location-description">
              <Input id="new-location-description" name="description" maxLength={200} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="isDefault" />
              {t("fields.isDefault")}
            </label>
          </div>
        </ActionForm>
      </Card>
      <Link href="/admin/warehouses" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToWarehouses")}
      </Link>
    </>
  );
}
