import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { NameFields } from "@/components/admin/catalog-fields";
import { GenerationFields, localName, VariantFields } from "@/components/admin/vehicle-fields";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { SEGMENTS, yearRange } from "@/modules/vehicles/domain/vehicle-input";
import {
  createGenerationAction,
  createMotorcycleVariantAction,
  updateGenerationAction,
  updateModelAction,
  updateMotorcycleVariantAction,
} from "@/modules/vehicles/api/vehicle-actions";
import { getModelForAdmin } from "@/modules/vehicles/service/motorcycles";

export default async function AdminMotorcycleModelPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => getModelForAdmin(actor, id), `/admin/motorcycles/models/${id}`);
  if (!data) notFound();
  const { model, brands } = data;
  const t = await getTranslations("AdminVehicles");
  const generationLabel = (g: { code: string | null; yearFrom: number; yearTo: number | null }) =>
    [yearRange(g.yearFrom, g.yearTo, t("now")), g.code].filter(Boolean).join(" · ");
  const generationOptions = model.generations.map((g) => ({ id: g.id, label: generationLabel(g) }));
  const hiddenModel = <input type="hidden" name="modelId" value={model.id} />;

  return (
    <>
      <PageHeader title={`${localName(model.brand.names, locale)} ${localName(model.names, locale)}`} description={t("modelEditIntro")} testId="admin-model-heading" />

      <Card title={t("generationsTitle")} description={t("generationsHelp")} testId="admin-generations">
        {model.generations.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-generations-empty">
            {t("generationsEmpty")}
          </p>
        ) : (
          <ol className="space-y-4">
            {model.generations.map((g) => (
              <li key={g.id} className="space-y-3 rounded-lg border p-3" data-testid="admin-generation-row">
                <h3 className="font-semibold" dir="ltr">
                  {generationLabel(g)}
                </h3>
                <details>
                  <summary className="cursor-pointer text-sm text-brand-orange-strong">{t("editYears")}</summary>
                  <ActionForm action={updateGenerationAction} submitLabel={t("save")} namespace="AdminVehicles" className="mt-2">
                    <input type="hidden" name="generationId" value={g.id} />
                    <GenerationFields idPrefix={g.id} values={g} />
                  </ActionForm>
                </details>
                {g.variants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("variantsEmpty")}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {g.variants.map((v) => (
                      <li key={v.id} className="p-2" data-testid="admin-motorcycle-variant-row">
                        <details>
                          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{localName(v.names, locale)}</span>
                            {v.engineDisplacementCc ? <Badge>{t("cc", { cc: v.engineDisplacementCc })}</Badge> : null}
                            {v.yearFrom ? <span className="text-xs text-muted-foreground">{yearRange(v.yearFrom, v.yearTo, t("now"))}</span> : null}
                            {v.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                          </summary>
                          <ActionForm action={updateMotorcycleVariantAction} submitLabel={t("save")} namespace="AdminVehicles" className="mt-2">
                            <input type="hidden" name="variantId" value={v.id} />
                            <VariantFields idPrefix={v.id} values={{ ...v, generationId: g.id }} generations={generationOptions} />
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="isActive" defaultChecked={v.isActive} />
                              {t("fields.isActive")}
                            </label>
                          </ActionForm>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("newGeneration")}>
          <ActionForm action={createGenerationAction} submitLabel={t("create")} testId="admin-generation-create" namespace="AdminVehicles">
            {hiddenModel}
            <GenerationFields idPrefix="new-gen" />
          </ActionForm>
        </Card>
        {model.generations.length ? (
          <Card title={t("newVariant")} description={t("newVariantHelp")}>
            <ActionForm action={createMotorcycleVariantAction} submitLabel={t("create")} testId="admin-motorcycle-variant-create" namespace="AdminVehicles">
              <VariantFields idPrefix="new-var" generations={generationOptions} />
            </ActionForm>
          </Card>
        ) : null}
      </div>

      <Card title={t("modelDetails")}>
        <ActionForm action={updateModelAction} submitLabel={t("save")} testId="admin-model-edit" namespace="AdminVehicles">
          {hiddenModel}
          <NameFields names={model.names} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("fields.brand")} htmlFor="brandId">
              <select id="brandId" name="brandId" className={selectClass} defaultValue={model.brandId}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {localName(b.names, locale)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fields.segment")} htmlFor="segment">
              <select id="segment" name="segment" className={selectClass} defaultValue={model.segment ?? ""}>
                <option value="">{t("notSet")}</option>
                {SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`segments.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fields.sortOrder")} htmlFor="sortOrder">
              <Input id="sortOrder" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(model.sortOrder)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={model.isActive} />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>
      <Link href={`/admin/motorcycles/brands/${model.brand.id}`} className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToBrand")}
      </Link>
    </>
  );
}
