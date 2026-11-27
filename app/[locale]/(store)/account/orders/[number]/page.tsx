import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { shopLocale } from "@/components/store/shop-locale";
import { formatCount } from "@/lib/i18n/numbers";
import { Link, redirect } from "@/lib/i18n/navigation";
import { formatMoney, subtract } from "@/lib/money";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { myOrder } from "@/modules/sales/service/checkout";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { provinceName } from "@/modules/shipping/service/provinces";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale, namespace: "Orders" });
  return { title: t("orderTitle", { number }), robots: { index: false } };
}

/** One of the signed-in customer's own orders; anyone else's is a 404. */
export default async function OrderPage({ params }: Props) {
  const { locale: raw, number } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const customer = await currentCustomer();
  if (!customer) redirect({ href: "/login", locale });
  const order = await myOrder(customer!, number);
  if (!order) notFound();
  const [t, unit] = await Promise.all([getTranslations("Orders"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const address = order.addresses[0];
  const method = order.shippingMethod?.translations.find((x) => x.locale === locale) ?? order.shippingMethod?.translations[0];
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(order.placedAt);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold" data-testid="order-heading">
          {t("orderTitle", { number: formatCount(Number(order.orderNumber), locale).replace(/[٬,]/g, "") })}
        </h1>
        <p className="text-sm text-muted-foreground">{date}</p>
        <p className="font-semibold" data-testid="order-status">
          {t(`status.${order.status}`)}
        </p>
      </div>
      {order.status === "pending_payment" ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm" data-testid="order-awaiting-payment">
          {t("awaitingPayment")}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border" data-testid="order-items">
        {order.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 p-3 text-sm">
            <span>
              {(locale === "en" ? i.titleEn : null) ?? i.titleFa}
              <span dir="ltr" className="ms-2 text-xs text-muted-foreground">
                {i.sku}
              </span>
              <span className="block text-muted-foreground">
                {formatCount(i.quantity, locale)} × {money(i.unitPrice)}
              </span>
            </span>
            <span className="shrink-0 font-semibold">{money(i.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-lg border p-4 text-sm">
        <dt>{t("goods")}</dt>
        <dd>{money(subtract(order.subtotal, order.discountTotal))}</dd>
        <dt>{method ? t("shippingVia", { method: method.name }) : t("shipping")}</dt>
        <dd>{order.shippingTotal === 0n ? t("free") : money(order.shippingTotal)}</dd>
        {order.taxTotal > 0n ? (
          <>
            <dt>{t("tax")}</dt>
            <dd>{money(order.taxTotal)}</dd>
          </>
        ) : null}
        <dt className="font-bold">{t("total")}</dt>
        <dd className="font-bold" data-testid="order-total">
          {money(order.grandTotal)}
        </dd>
      </dl>
      {address ? (
        <section className="space-y-1 rounded-lg border p-4 text-sm" data-testid="order-address">
          <h2 className="font-semibold">{t("deliverTo")}</h2>
          <p>{address.recipientName}</p>
          <p>{[address.provinceCode ? provinceName(address.provinceCode, locale) : address.province, address.city, address.addressLine].join(t("addressSeparator"))}</p>
          <p dir="ltr" className="text-start">
            {address.postalCode} · {address.phone}
          </p>
        </section>
      ) : null}
      <Link href="/account" className="text-sm underline">
        {t("allOrders")}
      </Link>
    </div>
  );
}
