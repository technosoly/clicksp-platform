import { randomUUID } from "node:crypto";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { recordMoneyAction } from "@/modules/accounting/api/accounting-actions";
import { moneyBook, tehranDay } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { AccountingTabs } from "../tabs";

type Option = { id: string; code: string; name: string };

export default async function AdminMoneyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => moneyBook(actor), "/admin/accounting/money");
  const [t, unit] = await Promise.all([getTranslations("AdminAccounting"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  const day = (d: Date) => formatDate(d, locale, { dateStyle: "medium", timeZone: "UTC" });
  const today = tehranDay(new Date()).toISOString().slice(0, 10);

  const form = (kind: "expense" | "income", main: Option[], other: Option[]) => (
    <ActionForm action={recordMoneyAction} submitLabel={t(`money.${kind}.save`)} testId={`admin-${kind}-create`} namespace="AdminAccounting">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={randomUUID()} />
      <input type="hidden" name="unit" value={unit} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("date")} htmlFor={`${kind}-date`}>
          <Input id={`${kind}-date`} name="date" type="date" dir="ltr" defaultValue={today} required />
        </Field>
        <Field label={t("money.amount", { unit: t(`unit.${unit}`) })} htmlFor={`${kind}-amount`}>
          <Input id={`${kind}-amount`} name="amount" inputMode="numeric" dir="ltr" required />
        </Field>
        <Field label={t(`money.${kind}.account`)} htmlFor={`${kind}-main`}>
          <select id={`${kind}-main`} name="mainAccountId" className={selectClass} required defaultValue="">
            <option value="">–</option>
            {main.map((a) => (
              <option key={a.id} value={a.id}>{`${a.code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        <Field label={t(`money.${kind}.moneyAccount`)} htmlFor={`${kind}-money`}>
          <select id={`${kind}-money`} name="moneyAccountId" className={selectClass} required defaultValue="">
            <option value="">–</option>
            {other.map((a) => (
              <option key={a.id} value={a.id}>{`${a.code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        <Field label={t(`money.${kind}.party`)} htmlFor={`${kind}-party`}>
          <Input id={`${kind}-party`} name="party" maxLength={200} />
        </Field>
        <Field label={t("description")} htmlFor={`${kind}-description`}>
          <Input id={`${kind}-description`} name="description" maxLength={500} required />
        </Field>
      </div>
    </ActionForm>
  );

  const list = (
    kind: "expense" | "income",
    rows: { id: string; number: bigint; date: Date; status: string; amount: bigint; party: string | null; description: string; account: { code: string; name: string }; journal: bigint | null }[],
  ) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t(`money.${kind}.empty`)}</p>
    ) : (
      <ul className="divide-y text-sm" data-testid={`admin-${kind}-list`}>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`admin-${kind}-row`}>
            <span dir="ltr" className="font-semibold">{`#${r.number}`}</span>
            <span>{day(r.date)}</span>
            <span>{`${r.account.code} · ${r.account.name}`}</span>
            {r.party ? <span className="text-muted-foreground">{r.party}</span> : null}
            <span className="text-muted-foreground">{r.description}</span>
            {r.status === "voided" ? <span className="text-xs text-muted-foreground" data-testid={`admin-${kind}-voided`}>{t("money.voided")}</span> : null}
            <span className={`ms-auto font-semibold ${r.status === "voided" ? "line-through" : ""}`}>{money(r.amount)}</span>
            {r.journal !== null ? (
              <Link href={`/admin/accounting/journal/${r.journal}`} className="text-xs underline" dir="ltr">
                {`J#${r.journal}`}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader title={t("money.title")} description={t("money.intro")} testId="admin-money-heading" />
      <AccountingTabs current="money" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("money.expense.title")}>
          {data.can.expense ? <div className="mb-4">{form("expense", data.expenseAccounts, data.moneyAccounts)}</div> : null}
          {list(
            "expense",
            data.expenses.map((e) => ({ id: e.id, number: e.expenseNumber, date: e.expenseDate, status: e.status, amount: e.amount, party: e.vendorName, description: e.description, account: e.expenseAccount, journal: e.accountingTransaction?.journalNumber ?? null })),
          )}
        </Card>
        <Card title={t("money.income.title")}>
          {data.can.income ? <div className="mb-4">{form("income", data.incomeAccounts, data.moneyAccounts.filter((a) => a.type === "asset"))}</div> : null}
          {list(
            "income",
            data.income.map((e) => ({ id: e.id, number: e.incomeNumber, date: e.incomeDate, status: e.status, amount: e.amount, party: e.payerName, description: e.description, account: e.incomeAccount, journal: e.accountingTransaction?.journalNumber ?? null })),
          )}
        </Card>
      </div>
    </>
  );
}
