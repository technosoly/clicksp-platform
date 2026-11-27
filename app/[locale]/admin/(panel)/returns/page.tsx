import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { returnsForAdmin } from "@/modules/sales/service/returns";
import { RETURN_TONE } from "./tones";

const STATUSES = ["requested", "approved", "received", "completed", "rejected"] as const;

export default async function AdminReturnsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const status = (await searchParams).status ?? null;
  const { data } = await adminPage(raw, (actor) => returnsForAdmin(actor, typeof status === "string" ? status : null), "/admin/returns");
  const t = await getTranslations("AdminReturns");
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" });
  const number = (n: bigint) => formatCount(Number(n), locale).replace(/[٬,]/g, "");

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-returns-heading" />
      <nav className="flex flex-wrap gap-1.5 text-sm" aria-label={t("filter")}>
        <Link href="/admin/returns" className={`rounded-md border px-2.5 py-1 ${data.status === null ? "bg-accent font-semibold" : ""}`}>
          {t("all")}
        </Link>
        {STATUSES.map((st) => (
          <Link key={st} href={`/admin/returns?status=${st}`} className={`rounded-md border px-2.5 py-1 ${data.status === st ? "bg-accent font-semibold" : ""}`}>
            {t(`status.${st}`)}
          </Link>
        ))}
      </nav>
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y" data-testid="admin-returns-list">
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="admin-return-row">
                <Link href={`/admin/returns/${r.returnNumber}`} className="font-semibold hover:underline">
                  {t("returnNumber", { number: number(r.returnNumber) })}
                </Link>
                <span>{t("forOrder", { number: number(r.order.orderNumber) })}</span>
                <span>{r.order.customerName}</span>
                <span>{t(`reasons.${r.reason}`)}</span>
                <span className="text-muted-foreground">{date.format(r.createdAt)}</span>
                <Badge tone={RETURN_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
