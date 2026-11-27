import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { advanceTransferAction, removeTransferLineAction, setTransferLineAction } from "@/modules/inventory/api/inventory-actions";
import { getTransferForAdmin } from "@/modules/inventory/service/transfers";
import { TRANSFER_TONE } from "../../tones";

export default async function AdminTransferPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => getTransferForAdmin(actor, id), `/admin/inventory/transfers/${id}`);
  if (!data) notFound();
  const { transfer, locations, can } = data;
  const t = await getTranslations("AdminInventory.transfers");
  const title = (translations: { locale: string; title: string }[]) =>
    (locale === "en" ? translations.find((x) => x.locale === "en")?.title : undefined) ?? translations.find((x) => x.locale === "fa")?.title ?? "";
  const code = new Map(locations.map((l) => [l.id, l.code]));
  const fromLocations = locations.filter((l) => l.warehouse.id === transfer.fromWarehouseId);
  const toLocations = locations.filter((l) => l.warehouse.id === transfer.toWarehouseId);
  const date = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: "medium", timeStyle: "short" }) : "–");
  return (
    <>
      <PageHeader
        title={t("detailTitle", { from: transfer.fromWarehouse.name, to: transfer.toWarehouse.name })}
        description={transfer.note ?? undefined}
        testId="admin-transfer-heading"
        actions={
          <Link href="/admin/inventory/transfers" className="text-sm underline">
            {t("all")}
          </Link>
        }
      />
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("statusLabel")}</dt>
            <dd>
              <Badge tone={TRANSFER_TONE[transfer.status]} testId="admin-transfer-status">
                {t(`status.${transfer.status}`)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("createdBy")}</dt>
            <dd>{`${transfer.createdBy.name} · ${date(transfer.createdAt)}`}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("shippedAt")}</dt>
            <dd>{date(transfer.shippedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("receivedAt")}</dt>
            <dd>{date(transfer.receivedAt)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">{t(`help.${transfer.status}`)}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {can.ship ? (
            <ActionForm action={advanceTransferAction} submitLabel={t("ship")} testId="admin-transfer-ship" namespace="AdminInventory">
              <input type="hidden" name="transferId" value={transfer.id} />
              <input type="hidden" name="step" value="ship" />
            </ActionForm>
          ) : null}
          {can.receive ? (
            <ActionForm action={advanceTransferAction} submitLabel={t("receive")} testId="admin-transfer-receive" namespace="AdminInventory">
              <input type="hidden" name="transferId" value={transfer.id} />
              <input type="hidden" name="step" value="receive" />
            </ActionForm>
          ) : null}
          {can.cancel ? (
            <ActionForm action={advanceTransferAction} submitLabel={t("cancel")} submitVariant="secondary" testId="admin-transfer-cancel" namespace="AdminInventory">
              <input type="hidden" name="transferId" value={transfer.id} />
              <input type="hidden" name="step" value="cancel" />
            </ActionForm>
          ) : null}
        </div>
      </Card>

      <Card title={t("linesTitle")} className="mt-4" testId="admin-transfer-lines">
        {transfer.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noLines")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pe-3 text-start font-medium">{t("product")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("sku")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("fromLocation")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("toLocation")}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t("quantity")}</th>
                  {can.edit ? <th className="py-1" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfer.lines.map((line) => (
                  <tr key={line.id} data-testid="admin-transfer-line">
                    <td className="py-1.5 pe-3">{title(line.variant.product.translations)}</td>
                    <td className="py-1.5 pe-3" dir="ltr">{line.variant.sku}</td>
                    <td className="py-1.5 pe-3" dir="ltr">{code.get(line.fromLocationId) ?? "–"}</td>
                    <td className="py-1.5 pe-3" dir="ltr">{code.get(line.toLocationId) ?? "–"}</td>
                    <td className="py-1.5 pe-3 text-end tabular-nums">{formatCount(line.quantity, locale)}</td>
                    {can.edit ? (
                      <td className="py-1.5 text-end">
                        <ActionForm action={removeTransferLineAction} submitLabel={t("remove")} submitVariant="ghost" namespace="AdminInventory">
                          <input type="hidden" name="transferId" value={transfer.id} />
                          <input type="hidden" name="lineId" value={line.id} />
                        </ActionForm>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {can.edit ? (
          <ActionForm action={setTransferLineAction} submitLabel={t("addLine")} testId="admin-transfer-add" namespace="AdminInventory" className="mt-4">
            <input type="hidden" name="transferId" value={transfer.id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t("sku")} htmlFor="line-sku">
                <Input id="line-sku" name="sku" dir="ltr" required maxLength={64} />
              </Field>
              <Field label={t("quantity")} htmlFor="line-qty">
                <Input id="line-qty" name="quantity" inputMode="numeric" required />
              </Field>
              <Field label={t("fromLocation")} htmlFor="line-from">
                <select id="line-from" name="fromLocationId" className={selectClass} dir="ltr">
                  {fromLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("toLocation")} htmlFor="line-to">
                <select id="line-to" name="toLocationId" className={selectClass} dir="ltr">
                  {toLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code}</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t("addLineHelp")}</p>
          </ActionForm>
        ) : null}
      </Card>
    </>
  );
}
