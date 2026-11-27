"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState, useTransition } from "react";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCount } from "@/lib/i18n/numbers";
import { placeOrderAction, shippingOptionsAction, type CheckoutState, type ShippingOption } from "@/modules/sales/api/checkout-actions";

export interface CheckoutAddress {
  recipientName: string;
  phone: string;
  provinceCode: string | null;
  city: string;
  addressLine: string;
  plaque: string | null;
  unit: string | null;
  postalCode: string;
}

/**
 * Address, delivery method and note. Delivery options and their prices come
 * from the server for the chosen province; the order itself is priced again
 * on the server when it is placed.
 */
export function CheckoutForm({ provinces, initial, accountPhone }: { provinces: { code: string; name: string }[]; initial: CheckoutAddress | null; accountPhone: string }) {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const shop = locale === "en" ? "en" : "fa";
  const [state, action] = useActionState<CheckoutState, FormData>(placeOrderAction, {});
  const [province, setProvince] = useState(initial?.provinceCode ?? "");
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!province) return;
    startLoading(async () => setOptions(await shippingOptionsAction(locale, province)));
  }, [province, locale]);

  const days = (o: ShippingOption) =>
    o.minDays !== null && o.maxDays !== null ? t("days", { min: formatCount(o.minDays, shop), max: formatCount(o.maxDays, shop) }) : o.maxDays !== null ? t("upToDays", { max: formatCount(o.maxDays, shop) }) : null;

  return (
    <form action={action} className="space-y-5" noValidate data-testid="checkout-form">
      <input type="hidden" name="locale" value={locale} />
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 font-semibold">{t("addressTitle")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="recipientName">{t("recipientName")}</Label>
            <Input id="recipientName" name="recipientName" required maxLength={160} autoComplete="name" defaultValue={initial?.recipientName ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input id="phone" name="phone" required dir="ltr" inputMode="tel" autoComplete="tel" maxLength={20} defaultValue={initial?.phone ?? accountPhone} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="provinceCode">{t("province")}</Label>
            <select
              id="provinceCode"
              name="provinceCode"
              required
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="checkout-province"
            >
              <option value="">{t("chooseProvince")}</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="city">{t("city")}</Label>
            <Input id="city" name="city" required maxLength={100} autoComplete="address-level2" defaultValue={initial?.city ?? ""} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="addressLine">{t("addressLine")}</Label>
          <Input id="addressLine" name="addressLine" required maxLength={500} autoComplete="street-address" defaultValue={initial?.addressLine ?? ""} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="plaque">{t("plaque")}</Label>
            <Input id="plaque" name="plaque" maxLength={20} defaultValue={initial?.plaque ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="unit">{t("unit")}</Label>
            <Input id="unit" name="unit" maxLength={20} defaultValue={initial?.unit ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="postalCode">{t("postalCode")}</Label>
            <Input id="postalCode" name="postalCode" required dir="ltr" inputMode="numeric" maxLength={12} autoComplete="postal-code" defaultValue={initial?.postalCode ?? ""} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="saveAddress" defaultChecked={initial === null} />
          {t("saveAddress")}
        </label>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border p-4" data-testid="checkout-shipping">
        <legend className="px-1 font-semibold">{t("shippingTitle")}</legend>
        {!province ? (
          <p className="text-sm text-muted-foreground">{t("chooseProvinceFirst")}</p>
        ) : loading || options === null ? (
          <p className="text-sm text-muted-foreground">{t("loadingShipping")}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-destructive" data-testid="checkout-no-shipping">
            {t("noShipping")}
          </p>
        ) : (
          options.map((o, i) => (
            <label key={o.methodId} className="flex items-start gap-3 rounded-md border p-3 text-sm" data-testid="checkout-shipping-option">
              <input type="radio" name="shippingMethodId" value={o.methodId} defaultChecked={i === 0} className="mt-1" />
              <span className="flex-1 space-y-0.5">
                <span className="block font-semibold">{o.name}</span>
                {o.description ? <span className="block text-muted-foreground">{o.description}</span> : null}
                {days(o) ? <span className="block text-muted-foreground">{days(o)}</span> : null}
              </span>
              <span className="font-bold">{o.free ? t("free") : o.cost}</span>
            </label>
          ))
        )}
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="note">{t("note")}</Label>
        <textarea id="note" name="note" maxLength={1000} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="checkout-error">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.unexpected")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("paymentNote")}</p>
      <SubmitButton label={t("placeOrder")} pendingLabel={t("placing")} testId="checkout-submit" />
    </form>
  );
}
