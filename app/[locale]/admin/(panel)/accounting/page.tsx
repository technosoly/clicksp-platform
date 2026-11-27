import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { retryPostingsAction } from "@/modules/accounting/api/accounting-actions";
import { accountingOverview } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { AccountingTabs } from "./tabs";

export default async function AdminAccountingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => accountingOverview(actor), "/admin/accounting");
  const t = await getTranslations("AdminAccounting");
  const missing = data.mappings.filter((m) => !m.accountId);
  const steps = [
    { key: "accounts", done: data.accounts.length > 0, href: "/admin/accounting/accounts" },
    { key: "mappings", done: missing.length === 0, href: "/admin/accounting/accounts#mappings" },
    { key: "period", done: data.currentPeriod !== null, href: "/admin/accounting/periods" },
  ];
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-accounting-heading" />
      <AccountingTabs current="overview" />
      <p className="mb-4 rounded-md border border-brand-orange/40 bg-brand-orange/5 px-3 py-2 text-sm">{t("disclaimer")}</p>
      <Card title={t("setup.title")} description={t("setup.help")}>
        <ul className="space-y-2 text-sm" data-testid="admin-accounting-setup">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2">
              <Badge tone={s.done ? "success" : "orange"}>{s.done ? t("setup.done") : t("setup.todo")}</Badge>
              <Link href={s.href} className="underline">
                {t(`setup.${s.key}`)}
              </Link>
              {s.key === "mappings" && missing.length > 0 ? <span className="text-muted-foreground">{t("setup.missing", { count: missing.length })}</span> : null}
              {s.key === "period" && data.currentPeriod ? <span className="text-muted-foreground">{data.currentPeriod.name}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("waiting.title")} description={t("waiting.help")} className="mt-4" testId="admin-accounting-waiting">
        {data.waiting.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t("waiting.none")}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">{t("waiting.count", { count: data.waiting.total })}</p>
            <ul className="mt-2 divide-y text-sm">
              {data.waiting.rows.map((w) => (
                <li key={w.id} className="flex flex-wrap gap-3 py-1.5">
                  <span>{t(`waiting.topics.${w.topic === "order.paid" ? "order_paid" : "refund_completed"}`)}</span>
                  <span className="text-muted-foreground">{formatDate(w.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span>{t(w.status === "failed" ? "waiting.stopped" : "waiting.retrying", { attempts: formatCount(w.attempts, locale) })}</span>
                  {w.lastError ? <span className="text-xs text-muted-foreground" dir="ltr">{w.lastError.slice(0, 160)}</span> : null}
                </li>
              ))}
            </ul>
            {data.can.post ? (
              <div className="mt-3">
                <ActionForm action={retryPostingsAction} submitLabel={t("waiting.retry")} testId="admin-accounting-retry" namespace="AdminAccounting" />
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
