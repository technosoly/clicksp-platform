import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { recordMovementAction } from "@/modules/inventory/api/inventory-actions";
import { ADJUSTMENT_REASONS, available } from "@/modules/inventory/domain/inventory-input";
import type { productStockForAdmin } from "@/modules/inventory/service/stock";

type Stock = NonNullable<Awaited<ReturnType<typeof productStockForAdmin>>>;

const INCOMING = new Set(["receipt", "return", "transfer_in", "adjustment_plus", "count_gain"]);

/** "Stock" on the product screen: what is where, recent movements, and recording a movement. */
export async function StockCard({ productId, stock, locale }: { productId: string; stock: Stock; locale: "fa" | "en" }) {
  const t = await getTranslations("AdminInventory");
  const n = (value: number) => formatCount(value, locale);
  const sku = new Map(stock.variants.map((v) => [v.id, v.sku]));
  const many = stock.variants.length > 1;

  return (
    <Card title={t("stockTitle")} description={t("stockHelp")} testId="admin-product-stock">
      {stock.balances.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="admin-stock-empty">
          {t("stockEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-stock-table">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-start">
                {many ? <th className="py-1 pe-3 text-start font-medium">{t("columns.sku")}</th> : null}
                <th className="py-1 pe-3 text-start font-medium">{t("columns.warehouse")}</th>
                <th className="py-1 pe-3 text-start font-medium">{t("columns.location")}</th>
                <th className="py-1 pe-3 text-end font-medium">{t("columns.onHand")}</th>
                <th className="py-1 pe-3 text-end font-medium">{t("columns.reserved")}</th>
                <th className="py-1 text-end font-medium">{t("columns.available")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stock.balances.map((b) => (
                <tr key={`${b.variantId}-${b.location.id}`} data-testid="admin-stock-row">
                  {many ? (
                    <td className="py-1.5 pe-3" dir="ltr">
                      {sku.get(b.variantId)}
                    </td>
                  ) : null}
                  <td className="py-1.5 pe-3">
                    <span dir="ltr">{b.warehouse.code}</span> <span className="text-muted-foreground">{b.warehouse.name}</span>
                  </td>
                  <td className="py-1.5 pe-3" dir="ltr">
                    {b.location.code}
                  </td>
                  <td className="py-1.5 pe-3 text-end tabular-nums" data-testid="admin-stock-on-hand">
                    {n(b.onHand)}
                  </td>
                  <td className="py-1.5 pe-3 text-end tabular-nums">{n(b.reserved)}</td>
                  <td className="py-1.5 text-end font-medium tabular-nums">{n(available(b))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stock.kinds.length > 0 && stock.variants.length > 0 ? (
        <ActionForm action={recordMovementAction} submitLabel={t("record")} testId="admin-stock-movement" namespace="AdminInventory" className="mt-4 border-t pt-4">
          <input type="hidden" name="productId" value={productId} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("fields.kind")} htmlFor="kind">
              <select id="kind" name="kind" className={selectClass} defaultValue={stock.kinds[0]}>
                {stock.kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            {many ? (
              <Field label={t("fields.variant")} htmlFor="variantId">
                <select id="variantId" name="variantId" className={selectClass} dir="ltr">
                  {stock.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="variantId" value={stock.variants[0]!.id} />
            )}
            <Field label={t("fields.location")} htmlFor="locationId">
              <select id="locationId" name="locationId" className={selectClass}>
                {stock.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${l.warehouse.code} / ${l.code}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fields.quantity")} htmlFor="quantity">
              <Input id="quantity" name="quantity" inputMode="numeric" dir="ltr" required maxLength={9} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("fields.reference")} htmlFor="reference" hint={t("fields.referenceHint")}>
              <Input id="reference" name="reference" dir="ltr" maxLength={100} />
            </Field>
            <Field label={t("fields.reason")} htmlFor="reason" hint={t("fields.reasonHint")}>
              <Input id="reason" name="reason" maxLength={500} />
            </Field>
            {stock.kinds.some((k) => k.startsWith("adjust")) ? (
              <Field label={t("fields.adjustmentReason")} htmlFor="adjustmentReason" hint={t("fields.adjustmentReasonHint")}>
                <select id="adjustmentReason" name="adjustmentReason" className={selectClass} defaultValue="">
                  <option value="">—</option>
                  {ADJUSTMENT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`adjustmentReasons.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="adjustmentReason" value="" />
            )}
          </div>
        </ActionForm>
      ) : null}

      {stock.movements.length > 0 ? (
        <details className="mt-4 border-t pt-3 text-sm" data-testid="admin-stock-history">
          <summary className="cursor-pointer font-medium">{t("historyTitle")}</summary>
          <ul className="mt-2 divide-y">
            {stock.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="admin-stock-movement-row">
                <Badge tone={INCOMING.has(m.type) ? "success" : "orange"}>{t(`types.${m.type}`)}</Badge>
                <span className="tabular-nums font-medium">{`${INCOMING.has(m.type) ? "+" : "−"}${n(m.quantity)}`}</span>
                <span className="text-muted-foreground">{t("onHandAfter", { count: n(m.onHandAfter) })}</span>
                <span dir="ltr" className="text-muted-foreground">{`${m.warehouse.code} / ${m.balance.location.code}`}</span>
                {many ? <span dir="ltr">{sku.get(m.variantId)}</span> : null}
                {m.referenceCode ? <span dir="ltr">{m.referenceCode}</span> : null}
                {m.reason ? <span>{m.reason}</span> : null}
                <span className="ms-auto text-xs text-muted-foreground">
                  {[m.actor?.name || m.actor?.username, formatDate(m.occurredAt, locale, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
