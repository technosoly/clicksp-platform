import { randomUUID } from "node:crypto";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { manualJournalAction } from "@/modules/accounting/api/accounting-actions";
import { journalForAdmin, MANUAL_LINES, tehranDay } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { AccountingTabs } from "../tabs";

export default async function AdminJournalPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const page = Number((await searchParams).page ?? "1") || 1;
  const { data } = await adminPage(raw, (actor) => journalForAdmin(actor, page), "/admin/accounting/journal");
  const [t, unit] = await Promise.all([getTranslations("AdminAccounting"), getDisplayUnit()]);
  const money = (v: bigint) => formatMoney(v, { locale, unit });
  return (
    <>
      <PageHeader title={t("journal.title")} description={t("journal.intro")} testId="admin-journal-heading" />
      <AccountingTabs current="journal" />
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("journal.empty")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="admin-journal-list">
            {data.rows.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-journal-row">
                <Link href={`/admin/accounting/journal/${j.journalNumber}`} className="font-semibold underline" dir="ltr">
                  {`#${j.journalNumber}`}
                </Link>
                <span>{formatDate(j.entryDate, locale, { dateStyle: "medium", timeZone: "UTC" })}</span>
                <span>{t(`sources.${j.sourceType}`)}</span>
                <span className="text-muted-foreground">{j.description}</span>
                <span className="ms-auto font-semibold">{money(j.amount)}</span>
                {j.reversedBy ? <span className="text-xs text-muted-foreground">{t("journal.reversedBy", { number: j.reversedBy.journalNumber.toString() })}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {data.pages > 1 ? (
          <p className="mt-3 flex gap-3 text-sm">
            {data.page > 1 ? <Link href={`/admin/accounting/journal?page=${data.page - 1}`}>{t("previous")}</Link> : null}
            <span className="text-muted-foreground">{t("page", { page: data.page, pages: data.pages })}</span>
            {data.page < data.pages ? <Link href={`/admin/accounting/journal?page=${data.page + 1}`}>{t("next")}</Link> : null}
          </p>
        ) : null}
      </Card>
      {data.canPost ? (
        <Card title={t("journal.newTitle")} description={t("journal.newHelp", { unit: t(`unit.${unit}`) })} className="mt-4">
          <ActionForm action={manualJournalAction} submitLabel={t("journal.post")} testId="admin-journal-create" namespace="AdminAccounting">
            <input type="hidden" name="key" value={randomUUID()} />
            <input type="hidden" name="unit" value={unit} />
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <Field label={t("date")} htmlFor="journal-date">
                <Input id="journal-date" name="date" type="date" dir="ltr" defaultValue={tehranDay(new Date()).toISOString().slice(0, 10)} required />
              </Field>
              <Field label={t("description")} htmlFor="journal-description">
                <Input id="journal-description" name="description" maxLength={500} required />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pe-2 text-start font-medium">{t("journal.account")}</th>
                    <th className="py-1 pe-2 text-start font-medium">{t("journal.debit")}</th>
                    <th className="py-1 pe-2 text-start font-medium">{t("journal.credit")}</th>
                    <th className="py-1 text-start font-medium">{t("journal.memo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: MANUAL_LINES }, (_, i) => (
                    <tr key={i} data-testid="admin-journal-line">
                      <td className="py-1 pe-2">
                        <select name={`account-${i}`} className={selectClass} aria-label={t("journal.lineAccount", { n: i + 1 })} defaultValue="">
                          <option value="">–</option>
                          {data.accounts.map((a) => (
                            <option key={a.id} value={a.id}>{`${a.code} · ${a.name}`}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pe-2">
                        <Input name={`debit-${i}`} inputMode="numeric" dir="ltr" className="w-32" aria-label={t("journal.lineDebit", { n: i + 1 })} />
                      </td>
                      <td className="py-1 pe-2">
                        <Input name={`credit-${i}`} inputMode="numeric" dir="ltr" className="w-32" aria-label={t("journal.lineCredit", { n: i + 1 })} />
                      </td>
                      <td className="py-1">
                        <Input name={`memo-${i}`} maxLength={500} aria-label={t("journal.lineMemo", { n: i + 1 })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
