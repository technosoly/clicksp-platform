import { getLocale, getTranslations } from "next-intl/server";
import { Field } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { METHOD_KINDS } from "@/modules/shipping/domain/shipping-input";
import { PROVINCES } from "@/modules/shipping/domain/provinces";

type Names = { locale: string; name: string; description?: string | null }[];
const named = (rows: Names | undefined, locale: string) => rows?.find((r) => r.locale === locale);

/** Zone fields: code, names and the provinces it covers. */
export async function ZoneFields({ z }: { z?: { code: string; translations: Names; regions: { provinceCode: string }[] } }) {
  const t = await getTranslations("AdminShipping");
  const locale = (await getLocale()) === "en" ? "en" : "fa";
  const chosen = new Set(z?.regions.map((r) => r.provinceCode));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("fields.code")} htmlFor="zone-code" hint={t("fields.codeHint")}>
          <Input id="zone-code" name="code" dir="ltr" required maxLength={50} defaultValue={z?.code} />
        </Field>
        <Field label={t("fields.faName")} htmlFor="zone-fa">
          <Input id="zone-fa" name="faName" required maxLength={100} defaultValue={named(z?.translations, "fa")?.name} />
        </Field>
        <Field label={t("fields.enName")} htmlFor="zone-en">
          <Input id="zone-en" name="enName" dir="ltr" maxLength={100} defaultValue={named(z?.translations, "en")?.name} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("fields.provinces")}</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {PROVINCES.map((p) => (
            <label key={p.code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="provinces" value={p.code} defaultChecked={chosen.has(p.code)} />
              {p[locale]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Delivery method fields. */
export async function MethodFields({
  m,
}: {
  m?: { code: string; kind: string; minDeliveryDays: number | null; maxDeliveryDays: number | null; sortOrder: number; translations: Names };
}) {
  const t = await getTranslations("AdminShipping");
  const fa = named(m?.translations, "fa");
  const en = named(m?.translations, "en");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("fields.code")} htmlFor="method-code" hint={t("fields.codeHint")}>
          <Input id="method-code" name="code" dir="ltr" required maxLength={50} defaultValue={m?.code} />
        </Field>
        <Field label={t("fields.kind")} htmlFor="method-kind">
          <select id="method-kind" name="kind" defaultValue={m?.kind ?? "post"} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {METHOD_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.sortOrder")} htmlFor="method-sort">
          <Input id="method-sort" name="sortOrder" dir="ltr" inputMode="numeric" maxLength={4} defaultValue={String(m?.sortOrder ?? 0)} className="max-w-28" />
        </Field>
        <Field label={t("fields.faName")} htmlFor="method-fa">
          <Input id="method-fa" name="faName" required maxLength={100} defaultValue={fa?.name} />
        </Field>
        <Field label={t("fields.enName")} htmlFor="method-en">
          <Input id="method-en" name="enName" dir="ltr" maxLength={100} defaultValue={en?.name} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("fields.minDays")} htmlFor="method-min">
            <Input id="method-min" name="minDays" dir="ltr" inputMode="numeric" maxLength={2} defaultValue={m?.minDeliveryDays?.toString() ?? ""} />
          </Field>
          <Field label={t("fields.maxDays")} htmlFor="method-max">
            <Input id="method-max" name="maxDays" dir="ltr" inputMode="numeric" maxLength={2} defaultValue={m?.maxDeliveryDays?.toString() ?? ""} />
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fields.faDescription")} htmlFor="method-fa-desc">
          <Input id="method-fa-desc" name="faDescription" maxLength={500} defaultValue={fa?.description ?? ""} />
        </Field>
        <Field label={t("fields.enDescription")} htmlFor="method-en-desc">
          <Input id="method-en-desc" name="enDescription" dir="ltr" maxLength={500} defaultValue={en?.description ?? ""} />
        </Field>
      </div>
    </>
  );
}
