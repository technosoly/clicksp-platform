import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { redirect } from "@/lib/i18n/navigation";
import { customerLogoutAction, customerNameAction } from "@/modules/identity/api/customer-actions";
import { addressAction } from "@/modules/sales/api/account-actions";
import { myAddresses } from "@/modules/sales/service/addresses";
import { provinceName } from "@/modules/shipping/service/provinces";
import { Input } from "@/components/ui/input";
import { readSessionToken } from "@/modules/identity/api/cookies";
import { getCustomer } from "@/modules/identity/service/customer-auth";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { myOrders } from "@/modules/sales/service/checkout";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  return { title: t("title"), robots: { index: false } };
}

/** The customer's account: their phone number and their own orders. */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await getCustomer(await readSessionToken("customer"));
  if (!customer) redirect({ href: "/login", locale });
  const t = await getTranslations("Account");
  const o = await getTranslations("Orders");
  const shop = locale === "en" ? "en" : "fa";
  const me = { userId: customer!.user.id, phone: customer!.user.phoneNumber ?? "", name: customer!.user.name || null };
  const [orders, addresses, unit] = await Promise.all([myOrders(me), myAddresses(me), getDisplayUnit()]);
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-bold" data-testid="account-heading">
          {t("title")}
        </h1>
        <p>
          {t("signedInAs")}{" "}
          <span dir="ltr" className="font-semibold">
            {customer!.user.phoneNumber}
          </span>
        </p>
        <form action={customerNameAction} className="flex flex-wrap items-end gap-2" data-testid="account-name">
          <label className="flex-1 space-y-1 text-sm">
            <span className="block text-muted-foreground">{t("name")}</span>
            <Input name="name" maxLength={120} defaultValue={customer!.user.name ?? ""} autoComplete="name" />
          </label>
          <Button type="submit" variant="outline">
            {t("saveName")}
          </Button>
        </form>
        <section className="space-y-2" data-testid="account-addresses">
          <h2 className="font-semibold">{t("addresses")}</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAddresses")}</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {addresses.map((a) => (
                <li key={a.id} className="space-y-2 p-3" data-testid="account-address">
                  <p>
                    {a.recipientName} · {[a.provinceCode ? provinceName(a.provinceCode, shop) : null, a.city, a.addressLine].filter(Boolean).join(o("addressSeparator"))}
                    {a.isDefault ? <span className="ms-2 rounded bg-accent px-1.5 py-0.5 text-xs">{t("defaultAddress")}</span> : null}
                  </p>
                  <form action={addressAction} className="flex gap-2">
                    <input type="hidden" name="addressId" value={a.id} />
                    {a.isDefault ? null : (
                      <Button type="submit" name="intent" value="default" variant="outline" size="sm">
                        {t("makeDefault")}
                      </Button>
                    )}
                    <Button type="submit" name="intent" value="remove" variant="ghost" size="sm" data-testid="account-address-remove">
                      {t("removeAddress")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2" data-testid="account-orders">
          <h2 className="font-semibold">{o("myOrders")}</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="account-orders-empty">
              {o("none")}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link href={`/account/orders/${order.orderNumber}`} className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-accent" data-testid="account-order-row">
                    <span className="font-semibold">{o("orderTitle", { number: formatCount(Number(order.orderNumber), shop).replace(/[٬,]/g, "") })}</span>
                    <span>{o(`status.${order.status}`)}</span>
                    <span>{formatMoney(order.grandTotal, { locale: shop, unit })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form action={customerLogoutAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="outline">
            {t("logout")}
          </Button>
        </form>
      </div>
    </div>
  );
}
