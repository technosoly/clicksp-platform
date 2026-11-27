import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { closePeriodAction, createPeriodAction } from "@/modules/accounting/api/accounting-actions";
import { accountingOverview } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { AccountingTabs } from "../tabs";

export default async function AdminPeriodsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => accountingOverview(actor), "/admin/accounting/periods");
  const t = await getTranslations("AdminAccounting");
  const d = (v: Date) => formatDate(v, locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <>
      <PageHeader title={t("periods.title")} description={t("periods.intro")} testId="admin-periods-heading" />
      <AccountingTabs current="periods" />
      <Card>
        {data.periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("periods.empty")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="admin-periods-list">
            {data.periods.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-period-row">
                <span className="font-semibold">{p.name}</span>
                <span>{`${d(p.startDate)} – ${d(p.endDate)}`}</span>
                <Badge tone={p.status === "open" ? "success" : "neutral"}>{t(`periods.status.${p.status}`)}</Badge>
                {p.closedBy?.name ? <span className="text-muted-foreground">{p.closedBy.name}</span> : null}
                {p.status === "open" && data.can.close ? (
                  <ActionForm action={closePeriodAction} submitLabel={t("periods.close")} submitVariant="outline" namespace="AdminAccounting" className="ms-auto">
                    <input type="hidden" name="periodId" value={p.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("periods.closeHelp")}</p>
      </Card>
      {data.can.post ? (
        <Card title={t("periods.newTitle")} description={t("periods.newHelp")} className="mt-4">
          <ActionForm action={createPeriodAction} submitLabel={t("create")} testId="admin-period-create" namespace="AdminAccounting">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("periods.name")} htmlFor="period-name">
                <Input id="period-name" name="name" maxLength={60} required />
              </Field>
              <Field label={t("periods.start")} htmlFor="period-start">
                <Input id="period-start" name="startDate" type="date" dir="ltr" required />
              </Field>
              <Field label={t("periods.end")} htmlFor="period-end">
                <Input id="period-end" name="endDate" type="date" dir="ltr" required />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
