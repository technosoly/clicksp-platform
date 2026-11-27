import { getTranslations } from "next-intl/server";
import { Field, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { COOLINGS, FUEL_SYSTEMS, STROKES } from "@/modules/vehicles/domain/vehicle-input";

/** Form pieces for the motorcycle screens (server components). */

type Names = Partial<Record<"fa" | "en", { name: string } | undefined>>;

/** A name in the page language (Persian when English is missing). */
export function localName(names: Names, locale: string): string {
  return (locale === "en" ? names.en?.name : undefined) ?? names.fa?.name ?? "";
}

export async function GenerationFields({ idPrefix, values }: { idPrefix: string; values?: { code: string | null; yearFrom: number; yearTo: number | null } }) {
  const t = await getTranslations("AdminVehicles");
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={t("fields.yearFrom")} htmlFor={id("yearFrom")} hint={t("fields.yearHint")}>
        <Input id={id("yearFrom")} name="yearFrom" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={values?.yearFrom?.toString() ?? ""} required />
      </Field>
      <Field label={t("fields.yearTo")} htmlFor={id("yearTo")}>
        <Input id={id("yearTo")} name="yearTo" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={values?.yearTo?.toString() ?? ""} />
      </Field>
      <Field label={t("fields.code")} htmlFor={id("code")} hint={t("fields.codeHint")}>
        <Input id={id("code")} name="code" dir="ltr" maxLength={50} defaultValue={values?.code ?? ""} />
      </Field>
    </div>
  );
}

export interface VariantValues {
  generationId: string;
  names: Names;
  code: string | null;
  engineDisplacementCc: number | null;
  engineStroke: string | null;
  cylinders: number | null;
  cooling: string | null;
  fuelSystem: string | null;
  marketCode: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export async function VariantFields({
  idPrefix,
  values,
  generations,
}: {
  idPrefix: string;
  values?: VariantValues;
  generations: { id: string; label: string }[];
}) {
  const t = await getTranslations("AdminVehicles");
  const id = (name: string) => `${idPrefix}-${name}`;
  const select = (name: string, label: string, options: readonly string[], group: "strokes" | "coolings" | "fuels", value: string | null) => (
    <Field label={label} htmlFor={id(name)}>
      <select id={id(name)} name={name} className={selectClass} defaultValue={value ?? ""}>
        <option value="">{t("notSet")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`${group}.${o}`)}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("fields.generation")} htmlFor={id("generationId")}>
          <select id={id("generationId")} name="generationId" className={selectClass} defaultValue={values?.generationId ?? generations[generations.length - 1]?.id ?? ""} required>
            {generations.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.faName")} htmlFor={id("faName")}>
          <Input id={id("faName")} name="faName" dir="rtl" lang="fa" maxLength={150} defaultValue={values?.names.fa?.name ?? ""} required />
        </Field>
        <Field label={t("fields.enName")} htmlFor={id("enName")}>
          <Input id={id("enName")} name="enName" dir="ltr" lang="en" maxLength={150} defaultValue={values?.names.en?.name ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("fields.cc")} htmlFor={id("cc")}>
          <Input id={id("cc")} name="engineDisplacementCc" inputMode="numeric" dir="ltr" defaultValue={values?.engineDisplacementCc?.toString() ?? ""} />
        </Field>
        {select("engineStroke", t("fields.stroke"), STROKES, "strokes", values?.engineStroke ?? null)}
        {select("cooling", t("fields.cooling"), COOLINGS, "coolings", values?.cooling ?? null)}
        {select("fuelSystem", t("fields.fuel"), FUEL_SYSTEMS, "fuels", values?.fuelSystem ?? null)}
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label={t("fields.cylinders")} htmlFor={id("cylinders")}>
          <Input id={id("cylinders")} name="cylinders" inputMode="numeric" dir="ltr" defaultValue={values?.cylinders?.toString() ?? ""} />
        </Field>
        <Field label={t("fields.yearFrom")} htmlFor={id("yearFrom")}>
          <Input id={id("yearFrom")} name="yearFrom" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={values?.yearFrom?.toString() ?? ""} />
        </Field>
        <Field label={t("fields.yearTo")} htmlFor={id("yearTo")}>
          <Input id={id("yearTo")} name="yearTo" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={values?.yearTo?.toString() ?? ""} />
        </Field>
        <Field label={t("fields.market")} htmlFor={id("market")} hint={t("fields.marketHint")}>
          <Input id={id("market")} name="marketCode" dir="ltr" maxLength={10} defaultValue={values?.marketCode ?? ""} />
        </Field>
        <Field label={t("fields.code")} htmlFor={id("code")}>
          <Input id={id("code")} name="code" dir="ltr" maxLength={50} defaultValue={values?.code ?? ""} />
        </Field>
      </div>
    </div>
  );
}
