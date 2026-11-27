import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createTransferAction } from "@/modules/inventory/api/inventory-actions";
import { listTransfersForAdmin, transferLocations } from "@/modules/inventory/service/transfers";
import { TRANSFER_TONE } from "../tones";


export default async function AdminTransfersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, async (actor) => ({ transfers: await listTransfersForAdmin(actor), locations: await transferLocations(actor) }), "/admin/inventory/transfers");
  const t = await getTranslations("AdminInventory.transfers");
  const warehouses = [...new Map(data.locations.map((l) => [l.warehouse.id, l.warehouse])).values()];
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-transfers-heading"
        actions={
          <Link href="/admin/inventory" className="text-sm underline">
            {t("back")}
          </Link>
        }
      />
      {warehouses.length >= 2 ? (
        <Card title={t("newTitle")} description={t("newHelp")}>
          <ActionForm action={createTransferAction} submitLabel={t("create")} testId="admin-transfer-new" namespace="AdminInventory">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("from")} htmlFor="transfer-from">
                <select id="transfer-from" name="fromWarehouseId" className={selectClass}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("to")} htmlFor="transfer-to">
                <select id="transfer-to" name="toWarehouseId" className={selectClass} defaultValue={warehouses[1]?.id}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t("note")} htmlFor="transfer-note">
              <Input id="transfer-note" name="note" maxLength={1000} />
            </Field>
          </ActionForm>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">{t("needTwo")}</p>
        </Card>
      )}
      <Card title={t("listTitle")} className="mt-4" testId="admin-transfers">
        {data.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {data.transfers.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-transfer-row">
                <Link href={`/admin/inventory/transfers/${x.id}`} className="font-medium hover:underline" dir="ltr">
                  {`${x.fromWarehouse.code} → ${x.toWarehouse.code}`}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("lineCount", { count: x._count.lines, n: formatCount(x._count.lines, locale) })}</span>
                  <span>{formatDate(x.createdAt, locale, { dateStyle: "medium" })}</span>
                  <Badge tone={TRANSFER_TONE[x.status]}>{t(`status.${x.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
