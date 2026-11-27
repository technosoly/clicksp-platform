import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { CURRENCY_LABELS, formatMoney } from "@/lib/money";
import { adminPage } from "@/modules/identity/api/admin-page";
import { addRateAction, removeRateAction, updateMethodAction } from "@/modules/shipping/api/shipping-actions";
import { methodForAdmin } from "@/modules/shipping/service/shipping-admin";
import { MethodFields } from "../../fields";

export default async function AdminShippingMethodPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => methodForAdmin(actor, id), `/admin/shipping/methods/${id}`);
  if (!data) notFound();
  const { method, zones, unit } = data;
  const t = await getTranslations("AdminShipping");
  const name = (rows: { locale: string; name: string }[]) => (rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "fa"))?.name ?? "";
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const grams = (v: number) => formatCount(v, locale);
  const hidden = <input type="hidden" name="methodId" value={method.id} />;
  const unitLabel = CURRENCY_LABELS[locale][unit];

  return (
    <>
      <PageHeader title={name(method.translations)} description={t("methodEditIntro")} testId="admin-shipping-method-heading" actions={<Link href="/admin/shipping" className="text-sm underline">{t("back")}</Link>} />
      <Card>
        <ActionForm action={updateMethodAction} submitLabel={t("save")} testId="admin-shipping-method-edit" namespace="AdminShipping">
          {hidden}
          <MethodFields m={method} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={method.isActive} />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>

      <Card title={t("ratesTitle")} description={t("ratesHelp")} testId="admin-shipping-rates">
        {method.rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ratesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {method.rates.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-shipping-rate-row">
                <span className="text-sm">
                  <strong>{name(r.zone.translations)}</strong> · {money(r.baseAmount)}
                  {r.perKgAmount > 0n ? ` + ${t("perKg", { amount: money(r.perKgAmount) })}` : ""}
                  {r.freeAboveSubtotal !== null ? ` · ${t("freeAbove", { amount: money(r.freeAboveSubtotal) })}` : ""}
                  {r.minWeightGrams > 0 || r.maxWeightGrams !== null ? ` · ${t("weightBand", { min: grams(r.minWeightGrams), max: r.maxWeightGrams === null ? "∞" : grams(r.maxWeightGrams) })}` : ""}
                </span>
                <ActionForm action={removeRateAction} submitLabel={t("remove")} submitVariant="outline" testId="admin-shipping-rate-remove" namespace="AdminShipping">
                  {hidden}
                  <input type="hidden" name="rateId" value={r.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("newRate")} description={t("newRateHelp", { unit: unitLabel })}>
        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("needZone")}</p>
        ) : (
          <ActionForm action={addRateAction} submitLabel={t("add")} testId="admin-shipping-rate-add" namespace="AdminShipping">
            {hidden}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("fields.zone")} htmlFor="rate-zone">
                <select id="rate-zone" name="zoneId" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {name(z.translations)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("fields.baseAmount")} htmlFor="rate-base">
                <Input id="rate-base" name="baseAmount" dir="ltr" inputMode="numeric" required maxLength={20} />
              </Field>
              <Field label={t("fields.perKgAmount")} htmlFor="rate-kg">
                <Input id="rate-kg" name="perKgAmount" dir="ltr" inputMode="numeric" maxLength={20} />
              </Field>
              <Field label={t("fields.freeAbove")} htmlFor="rate-free">
                <Input id="rate-free" name="freeAbove" dir="ltr" inputMode="numeric" maxLength={20} />
              </Field>
              <Field label={t("fields.minWeight")} htmlFor="rate-min">
                <Input id="rate-min" name="minWeightGrams" dir="ltr" inputMode="numeric" maxLength={7} />
              </Field>
              <Field label={t("fields.maxWeight")} htmlFor="rate-max">
                <Input id="rate-max" name="maxWeightGrams" dir="ltr" inputMode="numeric" maxLength={7} />
              </Field>
            </div>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
