import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { startCountAction } from "@/modules/inventory/api/inventory-actions";
import { listCountsForAdmin } from "@/modules/inventory/service/counts";
import { COUNT_TONE } from "../tones";

export default async function AdminCountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => listCountsForAdmin(actor), "/admin/inventory/counts");
  const t = await getTranslations("AdminInventory.counts");
  const warehouses = [...new Map(data.locations.map((l) => [l.warehouse.id, l.warehouse])).values()];
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-counts-heading"
        actions={
          <Link href="/admin/inventory" className="text-sm underline">
            {t("back")}
          </Link>
        }
      />
      {warehouses.length > 0 ? (
        <Card title={t("newTitle")} description={t("newHelp")}>
          <ActionForm action={startCountAction} submitLabel={t("start")} testId="admin-count-new" namespace="AdminInventory">
            <Field label={t("target")} htmlFor="count-target">
              <select id="count-target" name="target" className={selectClass}>
                {warehouses.map((w) => [
                  <option key={w.id} value={`${w.id}:`}>{t("wholeWarehouse", { name: `${w.code} · ${w.name}` })}</option>,
                  ...data.locations
                    .filter((l) => l.warehouse.id === w.id)
                    .map((l) => (
                      <option key={l.id} value={`${w.id}:${l.id}`}>{`${w.code} / ${l.code}`}</option>
                    )),
                ])}
              </select>
            </Field>
            <Field label={t("note")} htmlFor="count-note">
              <Input id="count-note" name="note" maxLength={1000} />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
      <Card title={t("listTitle")} className="mt-4" testId="admin-counts">
        {data.counts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {data.counts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-count-row">
                <Link href={`/admin/inventory/counts/${c.id}`} className="font-medium hover:underline">
                  {`${c.warehouse.code} · ${c.warehouse.name}`}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("lineCount", { count: c._count.lines, n: formatCount(c._count.lines, locale) })}</span>
                  <span>{formatDate(c.startedAt, locale, { dateStyle: "medium" })}</span>
                  <Badge tone={COUNT_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
