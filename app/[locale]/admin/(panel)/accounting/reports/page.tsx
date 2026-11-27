import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { reportsForAdmin } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { AccountingTabs } from "../tabs";

type Search = { from?: string; to?: string; account?: string };

export default async function AdminReportsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const q = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : "");
  const { data } = await adminPage(raw, (actor) => reportsForAdmin(actor, { from: one(q.from), to: one(q.to), accountId: one(q.account) }), "/admin/accounting/reports");
  const [t, unit] = await Promise.all([getTranslations("AdminAccounting"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const day = (d: Date) => formatDate(d, locale, { dateStyle: "medium", timeZone: "UTC" });
  const balanced = data.totals.debit === data.totals.credit;
  const th = "py-1 pe-3 text-start font-medium";
  const num = "py-1 pe-3 text-end tabular-nums";
  return (
    <>
      <PageHeader title={t("reports.title")} description={t("reports.intro")} testId="admin-reports-heading" />
      <AccountingTabs current="reports" />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3" data-testid="admin-reports-filter">
          <Field label={t("reports.from")} htmlFor="report-from">
            <Input id="report-from" name="from" type="date" dir="ltr" defaultValue={data.from} />
          </Field>
          <Field label={t("reports.to")} htmlFor="report-to">
            <Input id="report-to" name="to" type="date" dir="ltr" defaultValue={data.to} />
          </Field>
          <Field label={t("reports.ledgerAccount")} htmlFor="report-account">
            <select id="report-account" name="account" className={selectClass} defaultValue={data.ledger?.account.id ?? ""}>
              <option value="">–</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{`${a.code} · ${a.name}`}</option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="outline">{t("reports.show")}</Button>
        </form>
      </Card>

      <Card title={t("reports.profit.title")} description={t("reports.profit.help", { from: data.from, to: data.to })} className="mt-4" testId="admin-report-profit">
        <table className="w-full text-sm">
          <tbody>
            <tr><th colSpan={2} className={`${th} pt-2`}>{t("types.income")}</th></tr>
            {data.profit.income.map((r) => (
              <tr key={r.account_id}><td className="py-1 pe-3">{`${r.code} · ${r.name}`}</td><td className={num}>{money(r.amount)}</td></tr>
            ))}
            <tr className="border-t font-semibold"><td className="py-1 pe-3">{t("reports.profit.incomeTotal")}</td><td className={num}>{money(data.profit.incomeTotal)}</td></tr>
            <tr><th colSpan={2} className={`${th} pt-3`}>{t("types.expense")}</th></tr>
            {data.profit.expenses.map((r) => (
              <tr key={r.account_id}><td className="py-1 pe-3">{`${r.code} · ${r.name}`}</td><td className={num}>{money(r.amount)}</td></tr>
            ))}
            <tr className="border-t font-semibold"><td className="py-1 pe-3">{t("reports.profit.expenseTotal")}</td><td className={num}>{money(data.profit.expenseTotal)}</td></tr>
            <tr className="border-t-2 font-bold"><td className="py-2 pe-3">{t("reports.profit.net")}</td><td className={num} data-testid="admin-report-net">{money(data.profit.net)}</td></tr>
          </tbody>
        </table>
      </Card>

      <Card title={t("reports.trial.title")} description={t("reports.trial.help", { to: data.to })} className="mt-4" testId="admin-report-trial">
        {data.trial.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reports.trial.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className={th}>{t("journal.account")}</th>
                  <th className={th}>{t("accounts.type")}</th>
                  <th className={`${th} text-end`}>{t("journal.debit")}</th>
                  <th className={`${th} text-end`}>{t("journal.credit")}</th>
                  <th className={`${th} text-end`}>{t("reports.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {data.trial.map((r) => (
                  <tr key={r.account_id} className="border-t">
                    <td className="py-1 pe-3">
                      <Link href={`/admin/accounting/reports?from=${data.from}&to=${data.to}&account=${r.account_id}`} className="underline">{`${r.code} · ${r.name}`}</Link>
                    </td>
                    <td className="py-1 pe-3">{t(`types.${r.type}`)}</td>
                    <td className={num}>{money(r.debit)}</td>
                    <td className={num}>{money(r.credit)}</td>
                    <td className={num}>{money(r.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-1 pe-3" colSpan={2}>{t("reports.trial.total")}</td>
                  <td className={num}>{money(data.totals.debit)}</td>
                  <td className={num}>{money(data.totals.credit)}</td>
                  <td className="py-1 text-end text-xs" data-testid="admin-report-balanced">{balanced ? t("reports.trial.balanced") : t("reports.trial.unbalanced")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.ledger ? (
        <Card title={t("reports.ledger.title", { account: `${data.ledger.account.code} · ${data.ledger.account.name}` })} description={t("reports.ledger.help", { from: data.from, to: data.to })} className="mt-4" testId="admin-report-ledger">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className={th}>{t("date")}</th>
                  <th className={th}>{t("journal.number")}</th>
                  <th className={th}>{t("description")}</th>
                  <th className={`${th} text-end`}>{t("journal.debit")}</th>
                  <th className={`${th} text-end`}>{t("journal.credit")}</th>
                  <th className={`${th} text-end`}>{t("reports.balance")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t text-muted-foreground"><td className="py-1 pe-3" colSpan={5}>{t("reports.ledger.opening")}</td><td className={num}>{money(data.ledger.opening)}</td></tr>
                {data.ledger.lines.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pe-3">{day(l.transaction.entryDate)}</td>
                    <td className="py-1 pe-3"><Link href={`/admin/accounting/journal/${l.transaction.journalNumber}`} className="underline" dir="ltr">{`#${l.transaction.journalNumber}`}</Link></td>
                    <td className="py-1 pe-3">{l.memo ? `${l.transaction.description} · ${l.memo}` : l.transaction.description}</td>
                    <td className={num}>{l.debit > 0n ? money(l.debit) : ""}</td>
                    <td className={num}>{l.credit > 0n ? money(l.credit) : ""}</td>
                    <td className={num}>{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.ledger.cut ? <p className="mt-2 text-xs text-muted-foreground" data-testid="admin-report-ledger-cut">{t("reports.ledger.cut")}</p> : null}
        </Card>
      ) : null}
      <p className="mt-4 text-xs text-muted-foreground">{t("disclaimer")}</p>
    </>
  );
}
