import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { NameFields } from "@/components/admin/catalog-fields";
import { localName } from "@/components/admin/vehicle-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { SEGMENTS, yearRange } from "@/modules/vehicles/domain/vehicle-input";
import { createModelAction, updateMotorcycleBrandAction } from "@/modules/vehicles/api/vehicle-actions";
import { getMotorcycleBrandForAdmin } from "@/modules/vehicles/service/motorcycles";

export default async function AdminMotorcycleBrandPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => getMotorcycleBrandForAdmin(actor, id), `/admin/motorcycles/brands/${id}`);
  if (!data) notFound();
  const { brand, manufacturers } = data;
  const t = await getTranslations("AdminVehicles");
  const segmentSelect = (value: string | null, idPrefix: string) => (
    <Field label={t("fields.segment")} htmlFor={`${idPrefix}segment`}>
      <select id={`${idPrefix}segment`} name="segment" className={selectClass} defaultValue={value ?? ""}>
        <option value="">{t("notSet")}</option>
        {SEGMENTS.map((s) => (
          <option key={s} value={s}>
            {t(`segments.${s}`)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <>
      <PageHeader
        title={localName(brand.names, locale)}
        description={`${localName(brand.manufacturerNames, locale)} · ${t("brandEditIntro")}`}
        testId="admin-motorcycle-brand-heading"
      />
      <Card title={t("modelsTitle")} testId="admin-models">
        {brand.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("modelsEmpty")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-models-list">
            {brand.models.map((m) => {
              const first = m.generations[0];
              const last = m.generations[m.generations.length - 1];
              return (
                <li key={m.id}>
                  <Link href={`/admin/motorcycles/models/${m.id}`} className="block rounded-lg border p-3 hover:border-brand-orange" data-testid="admin-model-row">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{localName(m.names, locale)}</span>
                      {m.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[m.segment ? t(`segments.${m.segment}`) : null, first ? yearRange(first.yearFrom, last!.yearTo, t("now")) : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={t("newModel")} description={t("newModelHelp")}>
        <ActionForm action={createModelAction} submitLabel={t("create")} testId="admin-model-create" namespace="AdminVehicles">
          <input type="hidden" name="brandId" value={brand.id} />
          <NameFields idPrefix="new-" />
          <div className="grid gap-4 sm:grid-cols-2">{segmentSelect(null, "new-")}</div>
        </ActionForm>
      </Card>
      <Card title={t("brandDetails")}>
        <ActionForm action={updateMotorcycleBrandAction} submitLabel={t("save")} testId="admin-motorcycle-brand-edit" namespace="AdminVehicles">
          <input type="hidden" name="brandId" value={brand.id} />
          <NameFields names={brand.names} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.manufacturer")} htmlFor="manufacturerId">
              <select id="manufacturerId" name="manufacturerId" className={selectClass} defaultValue={brand.manufacturerId}>
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {localName(m.names, locale)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fields.sortOrder")} htmlFor="sortOrder">
              <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(brand.sortOrder)} className="max-w-40" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={brand.isActive} />
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
