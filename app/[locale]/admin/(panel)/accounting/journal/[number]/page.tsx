import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { reverseJournalAction } from "@/modules/accounting/api/accounting-actions";
import { journalEntryForAdmin } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export default async function AdminJournalEntryPage({ params }: { params: Promise<{ locale: string; number: string }> }) {
  const { locale: raw, number } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => journalEntryForAdmin(actor, number), `/admin/accounting/journal/${number}`);
  if (!data) notFound();
  const { journal } = data;
  const [t, unit] = await Promise.all([getTranslations("AdminAccounting"), getDisplayUnit()]);
  const money = (v: bigint) => (v === 0n ? "" : formatMoney(v, { locale, unit }));
  return (
    <>
      <PageHeader
        title={t("journal.entryTitle", { number: journal.journalNumber.toString() })}
        description={`${t(`sources.${journal.sourceType}`)} · ${formatDate(journal.entryDate, locale, { dateStyle: "medium", timeZone: "UTC" })} · ${journal.period.name}`}
        testId="admin-journal-entry-heading"
        actions={
          <Link href="/admin/accounting/journal" className="text-sm underline">
            {t("journal.all")}
          </Link>
        }
      />
      <Card>
        <p className="text-sm">{journal.description}</p>
        {journal.createdBy?.name ? <p className="mt-1 text-xs text-muted-foreground">{journal.createdBy.name}</p> : null}
        {journal.reverses ? (
          <p className="mt-2 text-sm">
            <Link href={`/admin/accounting/journal/${journal.reverses.journalNumber}`} className="underline">
              {t("journal.reverses", { number: journal.reverses.journalNumber.toString() })}
            </Link>
          </p>
        ) : null}
        {journal.reversedBy ? (
          <p className="mt-2 text-sm">
            <Link href={`/admin/accounting/journal/${journal.reversedBy.journalNumber}`} className="underline">
              {t("journal.reversedBy", { number: journal.reversedBy.journalNumber.toString() })}
            </Link>
          </p>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-journal-entries">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pe-3 text-start font-medium">{t("journal.account")}</th>
                <th className="py-1 pe-3 text-end font-medium">{t("journal.debit")}</th>
                <th className="py-1 pe-3 text-end font-medium">{t("journal.credit")}</th>
                <th className="py-1 text-start font-medium">{t("journal.memo")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {journal.entries.map((e) => (
                <tr key={e.lineNo}>
                  <td className="py-1.5 pe-3">
                    <span dir="ltr" className="font-mono">{e.account.code}</span> {e.account.name}
                  </td>
                  <td className="py-1.5 pe-3 text-end tabular-nums">{money(e.debit)}</td>
                  <td className="py-1.5 pe-3 text-end tabular-nums">{money(e.credit)}</td>
                  <td className="py-1.5 text-muted-foreground">{e.memo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {data.canReverse ? (
        <Card title={t("journal.reverseTitle")} description={t("journal.reverseHelp")} className="mt-4">
          <ActionForm action={reverseJournalAction} submitLabel={t("journal.reverse")} submitVariant="outline" testId="admin-journal-reverse" namespace="AdminAccounting">
            <input type="hidden" name="journalNumber" value={journal.journalNumber.toString()} />
            <Field label={t("reason")} htmlFor="reverse-reason">
              <Input id="reverse-reason" name="reason" maxLength={400} required />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
