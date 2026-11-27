import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { adminPage } from "@/modules/identity/api/admin-page";
import { orderPaymentsForAdmin } from "@/modules/payments/service/payments-admin";
import { cancelOrderAction, fulfilOrderAction } from "@/modules/sales/api/order-admin-actions";
import { orderForAdmin } from "@/modules/sales/service/orders-admin";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { provinceName } from "@/modules/shipping/service/provinces";

export default async function AdminOrderPage({ params }: { params: Promise<{ locale: string; number: string }> }) {
  const { locale: raw, number } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(
    raw,
    async (actor) => {
      const found = await orderForAdmin(actor, number);
      return found ? { ...found, payments: await orderPaymentsForAdmin(actor, found.order.id) } : null;
    },
    `/admin/orders/${number}`,
  );
  if (!data) notFound();
  const { order, canCancel, payments, fulfilStep, shipments } = data;
  const p = await getTranslations("AdminPayments");
  const [t, s, o, unit] = await Promise.all([getTranslations("AdminOrders"), getTranslations("Orders.status"), getTranslations("Orders"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const address = order.addresses[0];
  const method = order.shippingMethod?.translations.find((x) => x.locale === locale) ?? order.shippingMethod?.translations[0];
  const title = t("orderNumber", { number: formatCount(Number(order.orderNumber), locale).replace(/[٬,]/g, "") });

  return (
    <>
      <PageHeader title={title} description={`${s(order.status)} · ${date.format(order.placedAt)}`} testId="admin-order-heading" actions={<Link href="/admin/orders" className="text-sm underline">{t("back")}</Link>} />
      <Card title={t("customer")}>
        <p className="text-sm">
          {order.customerName} ·{" "}
          <span dir="ltr" data-testid="admin-order-phone">
            {order.customerPhone}
          </span>
        </p>
        {order.customerNote ? <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">{order.customerNote}</p> : null}
      </Card>
      <Card title={t("items")}>
        <ul className="divide-y text-sm" data-testid="admin-order-items">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-2">
              <span>
                {(locale === "en" ? i.titleEn : null) ?? i.titleFa}{" "}
                <span dir="ltr" className="text-xs text-muted-foreground">
                  {i.sku}
                </span>
                <span className="block text-muted-foreground">
                  {formatCount(i.quantity, locale)} × {money(i.unitPrice)}
                </span>
              </span>
              <span className="font-semibold">{money(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t pt-3 text-sm">
          <dt>{method ? o("shippingVia", { method: method.name }) : o("shipping")}</dt>
          <dd>{money(order.shippingTotal)}</dd>
          <dt className="font-bold">{o("total")}</dt>
          <dd className="font-bold" data-testid="admin-order-total">
            {money(order.grandTotal)}
          </dd>
        </dl>
      </Card>
      {address ? (
        <Card title={o("deliverTo")}>
          <p className="text-sm">{address.recipientName}</p>
          <p className="text-sm">{[address.provinceCode ? provinceName(address.provinceCode, locale) : address.province, address.city, address.addressLine].join(o("addressSeparator"))}</p>
          <p dir="ltr" className="text-start text-sm">
            {[address.plaque, address.unit, address.postalCode, address.phone].filter(Boolean).join(" · ")}
          </p>
        </Card>
      ) : null}
      {payments ? (
        <Card title={p("orderPayments")} testId="admin-order-payments">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{p("noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {payments.map((pay) => (
                <li key={pay.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2" data-testid="admin-order-payment">
                  <span className="font-semibold">{p(`status.${pay.status}`)}</span>
                  <span>{p.has(`gateways.${pay.provider.code}`) ? p(`gateways.${pay.provider.code}`) : pay.provider.code}</span>
                  <span>{money(pay.amount)}</span>
                  <span>{date.format(pay.initiatedAt)}</span>
                  {pay.providerReference ? (
                    <span>
                      {p("reference")} <span dir="ltr">{pay.providerReference}</span>
                    </span>
                  ) : null}
                  {pay.maskedCard ? <span dir="ltr">{pay.maskedCard}</span> : null}
                  {pay.failureCode ? <span className="text-muted-foreground" dir="ltr">{pay.failureCode}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {fulfilStep ? (
        <Card title={t(`fulfil.${fulfilStep}.title`)} description={t(`fulfil.${fulfilStep}.help`)} testId="admin-order-fulfil">
          <ActionForm action={fulfilOrderAction} submitLabel={t(`fulfil.${fulfilStep}.submit`)} testId={`admin-order-${fulfilStep}`} namespace="AdminOrders">
            <input type="hidden" name="orderNumber" value={order.orderNumber.toString()} />
            <input type="hidden" name="step" value={fulfilStep} />
            {fulfilStep === "ship" ? (
              <Field label={t("fulfil.trackingCode")} htmlFor="tracking-code" hint={t("fulfil.trackingHint")}>
                <Input id="tracking-code" name="trackingCode" dir="ltr" maxLength={60} />
              </Field>
            ) : null}
          </ActionForm>
        </Card>
      ) : null}
      {shipments.length > 0 ? (
        <Card title={t("shipments")}>
          <ul className="divide-y text-sm" data-testid="admin-order-shipments">
            {shipments.map((sh) => (
              <li key={sh.id} className="flex flex-wrap gap-x-3 gap-y-1 py-1.5">
                <span dir="ltr">{sh.warehouse.code}</span>
                <span>{t(`shipmentStatus.${sh.status}`)}</span>
                {sh.trackingCode ? <span dir="ltr">{sh.trackingCode}</span> : null}
                {sh.shippedAt ? <span>{date.format(sh.shippedAt)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={t("stock")} description={t("stockHelp")}>
        <ul className="divide-y text-sm" data-testid="admin-order-holds">
          {order.reservations.map((r, n) => (
            <li key={n} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span dir="ltr">
                {r.balance.warehouse.code} / {r.balance.location.code}
              </span>
              <span>{formatCount(r.quantity, locale)}</span>
              <span>{t(`holds.${r.status}`)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("history")}>
        <ul className="space-y-1 text-sm" data-testid="admin-order-history">
          {order.statusHistory.map((h, n) => (
            <li key={n}>
              {date.format(h.createdAt)} · {s(h.toStatus)}
              {h.actor?.name ? ` · ${h.actor.name}` : ""}
              {h.reason ? ` · ${h.reason === "payment_window_expired" ? t("expiredReason") : h.reason === "online_payment" ? t("onlinePaymentReason") : h.reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>
      {canCancel ? (
        <Card title={t("cancelTitle")} description={t("cancelHelp")}>
          <ActionForm action={cancelOrderAction} submitLabel={t("cancel")} submitVariant="outline" testId="admin-order-cancel" namespace="AdminOrders">
            <input type="hidden" name="orderNumber" value={order.orderNumber.toString()} />
            <Field label={t("reason")} htmlFor="cancel-reason">
              <Input id="cancel-reason" name="reason" required maxLength={500} />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
