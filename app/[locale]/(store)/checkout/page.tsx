import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutForm } from "@/components/store/checkout-form";
import { shopLocale } from "@/components/store/shop-locale";
import { formatCount } from "@/lib/i18n/numbers";
import { redirect } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { checkoutPage } from "@/modules/sales/service/checkout";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { PROVINCES } from "@/modules/shipping/service/provinces";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Checkout" });
  return { title: t("title"), robots: { index: false } };
}

/** Checkout: signed-in customers only (orders are tied to a verified mobile number). */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const customer = await currentCustomer();
  if (!customer) redirect({ href: "/login?next=/checkout", locale });
  const [{ cart, addresses }, t, unit] = await Promise.all([checkoutPage(customer!, locale), getTranslations("Checkout"), getDisplayUnit()]);
  if (cart.lines.length === 0 || !cart.ready) redirect({ href: "/cart", locale });
  const saved = addresses[0] ?? null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold" data-testid="checkout-heading">
          {t("title")}
        </h1>
        <CheckoutForm
          provinces={PROVINCES.map((p) => ({ code: p.code, name: p[locale] }))}
          initial={saved ? { ...saved, phone: saved.phone.replace(/^\+98/, "0") } : null}
          accountPhone={customer!.phone.replace(/^\+98/, "0")}
        />
      </div>
      <aside className="h-fit space-y-3 rounded-lg border bg-card p-4" data-testid="checkout-summary">
        <h2 className="font-semibold">{t("summary")}</h2>
        <ul className="divide-y text-sm">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-2 py-2">
              <span>
                {l.item?.title} × {formatCount(l.quantity, locale)}
              </span>
              <span className="shrink-0">{l.lineTotal !== null ? formatMoney(l.lineTotal, { locale, unit }) : null}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between font-bold">
          <span>{t("goods")}</span>
          <span data-testid="checkout-goods-total">{formatMoney(cart.subtotal, { locale, unit })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t("shippingAdded")}</p>
      </aside>
    </div>
  );
}
