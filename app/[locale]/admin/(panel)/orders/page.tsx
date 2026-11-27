import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { adminPage } from "@/modules/identity/api/admin-page";
import { ORDER_STATUSES, ordersForAdmin } from "@/modules/sales/service/orders-admin";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export default async function AdminOrdersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const status = (await searchParams).status ?? null;
  const { data } = await adminPage(raw, (actor) => ordersForAdmin(actor, typeof status === "string" ? status : null), "/admin/orders");
  const [t, s, unit] = await Promise.all([getTranslations("AdminOrders"), getTranslations("Orders.status"), getDisplayUnit()]);
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" });
  const number = (n: bigint) => formatCount(Number(n), locale).replace(/[٬,]/g, "");

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-orders-heading" />
      <nav className="flex flex-wrap gap-1.5 text-sm" aria-label={t("filter")}>
        <Link href="/admin/orders" className={`rounded-md border px-2.5 py-1 ${data.status === null ? "bg-accent font-semibold" : ""}`}>
          {t("all")}
        </Link>
        {ORDER_STATUSES.map((st) => (
          <Link key={st} href={`/admin/orders?status=${st}`} className={`rounded-md border px-2.5 py-1 ${data.status === st ? "bg-accent font-semibold" : ""}`}>
            {s(st)}
          </Link>
        ))}
      </nav>
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-orders-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y" data-testid="admin-orders-list">
            {data.rows.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="admin-order-row">
                <Link href={`/admin/orders/${o.orderNumber}`} className="font-semibold hover:underline">
                  {t("orderNumber", { number: number(o.orderNumber) })}
                </Link>
                <span>{o.customerName}</span>
                <span className="text-muted-foreground">{date.format(o.placedAt)}</span>
                <span>{formatMoney(o.grandTotal, { locale, unit })}</span>
                <Badge tone={o.status === "cancelled" ? "danger" : "neutral"}>{s(o.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
        {data.limited ? <p className="mt-2 text-xs text-muted-foreground">{t("limited")}</p> : null}
      </Card>
    </>
  );
}
