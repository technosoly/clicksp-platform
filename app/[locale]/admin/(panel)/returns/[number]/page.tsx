import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney, toToman } from "@/lib/money";
import { adminPage } from "@/modules/identity/api/admin-page";
import { decideReturnAction, receiveReturnAction, refundAction } from "@/modules/sales/api/return-actions";
import { REFUND_METHODS } from "@/modules/sales/domain/returns";
import { returnForAdmin } from "@/modules/sales/service/returns";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { RETURN_TONE } from "../tones";

export default async function AdminReturnPage({ params }: { params: Promise<{ locale: string; number: string }> }) {
  const { locale: raw, number } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => returnForAdmin(actor, number), `/admin/returns/${number}`);
  if (!data) notFound();
  const { ret, can, locations } = data;
  const [t, unit] = await Promise.all([getTranslations("AdminReturns"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const n = (v: bigint | number) => formatCount(Number(v), locale).replace(/[٬,]/g, "");
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  // The amount field is typed in the display unit, so the suggestion is too (whole Toman, rounded down).
  const suggested = unit === "toman" ? toToman(data.suggestedRefund).whole.toString() : data.suggestedRefund.toString();
  const title = (i: { titleFa: string; titleEn: string | null }) => (locale === "en" ? i.titleEn : null) ?? i.titleFa;

  return (
    <>
      <PageHeader
        title={t("returnNumber", { number: n(ret.returnNumber) })}
        description={`${t(`reasons.${ret.reason}`)} · ${date.format(ret.createdAt)}`}
        testId="admin-return-heading"
        actions={
          <Link href="/admin/returns" className="text-sm underline">
            {t("back")}
          </Link>
        }
      />
      <Card>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={RETURN_TONE[ret.status]} testId="admin-return-status">
            {t(`status.${ret.status}`)}
          </Badge>
          <Link href={`/admin/orders/${ret.order.orderNumber}`} className="underline">
            {t("forOrder", { number: n(ret.order.orderNumber) })}
          </Link>
          <span>{ret.order.customerName}</span>
          <span dir="ltr">{ret.order.customerPhone}</span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t(`help.${ret.status}`)}</p>
        {ret.customerNote ? <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">{ret.customerNote}</p> : null}
        {ret.adminNote ? <p className="mt-2 text-sm">{t("adminNote", { note: ret.adminNote })}</p> : null}
      </Card>

      <Card title={t("items")} className="mt-4">
        {can.receive ? (
          <ActionForm action={receiveReturnAction} submitLabel={t("receive")} testId="admin-return-receive" namespace="AdminReturns">
            <input type="hidden" name="returnNumber" value={ret.returnNumber.toString()} />
            <p className="text-sm text-muted-foreground">{t("receiveHelp")}</p>
            <ul className="divide-y text-sm">
              {ret.items.map((item) => (
                <li key={item.id} className="grid gap-2 py-2 sm:grid-cols-[1fr_auto_auto_12rem]" data-testid="admin-return-item">
                  <input type="hidden" name="itemId" value={item.id} />
                  <span>
                    {title(item.orderItem)} <span dir="ltr" className="text-xs text-muted-foreground">{item.orderItem.sku}</span>
                    <span className="block text-muted-foreground">{t("units", { count: item.quantity })}</span>
                  </span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name={`restock-${item.id}`} defaultChecked />
                    {t("restock")}
                  </label>
                  <select name={`location-${item.id}`} className={selectClass} dir="ltr" aria-label={t("location")}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{`${l.warehouse.code} / ${l.code}`}</option>
                    ))}
                  </select>
                  <Input name={`condition-${item.id}`} maxLength={200} placeholder={t("condition")} aria-label={t("condition")} />
                </li>
              ))}
            </ul>
          </ActionForm>
        ) : (
          <ul className="divide-y text-sm">
            {ret.items.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2" data-testid="admin-return-item">
                <span>
                  {title(item.orderItem)} <span dir="ltr" className="text-xs text-muted-foreground">{item.orderItem.sku}</span>
                </span>
                <span>{t("units", { count: item.quantity })}</span>
                {ret.receivedAt ? <span>{item.restock ? t("restocked") : t("notRestocked")}</span> : null}
                {item.condition ? <span className="text-muted-foreground">{item.condition}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can.decide ? (
        <Card title={t("decideTitle")} className="mt-4">
          <div className="flex flex-wrap gap-4">
            <ActionForm action={decideReturnAction} submitLabel={t("approve")} testId="admin-return-approve" namespace="AdminReturns">
              <input type="hidden" name="returnNumber" value={ret.returnNumber.toString()} />
              <input type="hidden" name="decision" value="approve" />
            </ActionForm>
            <ActionForm action={decideReturnAction} submitLabel={t("reject")} submitVariant="outline" testId="admin-return-reject" namespace="AdminReturns">
              <input type="hidden" name="returnNumber" value={ret.returnNumber.toString()} />
              <input type="hidden" name="decision" value="reject" />
              <Field label={t("rejectNote")} htmlFor="reject-note">
                <Input id="reject-note" name="note" maxLength={1000} />
              </Field>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      {can.refund ? (
        <Card title={t("refundTitle")} description={t("refundHelp", { remaining: money(data.remaining) })} className="mt-4">
          <ActionForm action={refundAction} submitLabel={t("refund")} testId="admin-return-refund" namespace="AdminReturns">
            <input type="hidden" name="orderNumber" value={ret.order.orderNumber.toString()} />
            <input type="hidden" name="returnNumber" value={ret.returnNumber.toString()} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("amount", { unit: t(`unit.${unit}`) })} htmlFor="refund-amount" hint={t("suggested", { amount: money(data.suggestedRefund) })}>
                <Input id="refund-amount" name="amount" inputMode="numeric" dir="ltr" defaultValue={suggested} required />
              </Field>
              <Field label={t("method")} htmlFor="refund-method">
                <select id="refund-method" name="method" className={selectClass}>
                  {REFUND_METHODS.map((m) => (
                    <option key={m} value={m}>{t(`methods.${m}`)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("reason")} htmlFor="refund-reason">
                <Input id="refund-reason" name="reason" maxLength={500} required defaultValue={t("defaultReason", { number: n(ret.returnNumber) })} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {can.close ? (
        <Card title={t("closeTitle")} description={t("closeHelp")} className="mt-4">
          <ActionForm action={decideReturnAction} submitLabel={t("close")} submitVariant="outline" testId="admin-return-close" namespace="AdminReturns">
            <input type="hidden" name="returnNumber" value={ret.returnNumber.toString()} />
            <input type="hidden" name="decision" value="close" />
          </ActionForm>
        </Card>
      ) : null}

      {ret.refunds.length > 0 ? (
        <Card title={t("refunds")} className="mt-4">
          <ul className="divide-y text-sm" data-testid="admin-return-refunds">
            {ret.refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-3 py-1.5">
                <span className="font-semibold">{money(r.amount)}</span>
                <span>{t(`methods.${r.method}`)}</span>
                <span>{date.format(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
