import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { isLocale } from "@/lib/i18n/config";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { available } from "@/modules/inventory/domain/inventory-input";
import { inventoryOverview } from "@/modules/inventory/service/stock";

export default async function AdminInventoryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = (await searchParams).sku;
  const sku = typeof query === "string" ? query : "";
  const { data, actor } = await adminPage(locale, (actor) => inventoryOverview(actor, sku), "/admin/inventory");
  const t = await getTranslations("AdminInventory");
  const loc = isLocale(locale) ? locale : "fa";
  const n = (value: number) => formatCount(value, loc);
  const title = (translations: { locale: string; title: string }[]) =>
    (loc === "en" ? translations.find((x) => x.locale === "en")?.title : undefined) ?? translations.find((x) => x.locale === "fa")?.title ?? "";

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-inventory-heading"
        actions={
          <span className="flex flex-wrap gap-3 text-sm">
            {actor.permissions.has("inventory.transfer") ? (
              <Link href="/admin/inventory/transfers" className="text-brand-orange-strong underline" data-testid="admin-inventory-transfers">
                {t("transfers.title")}
              </Link>
            ) : null}
            {actor.permissions.has("inventory.count") ? (
              <Link href="/admin/inventory/counts" className="text-brand-orange-strong underline" data-testid="admin-inventory-counts">
                {t("counts.title")}
              </Link>
            ) : null}
            {actor.permissions.has("warehouse.manage") ? (
              <Link href="/admin/warehouses" className="text-brand-orange-strong underline">
                {t("manageWarehouses")}
              </Link>
            ) : null}
          </span>
        }
      />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <label className="sr-only" htmlFor="sku">
            {t("searchSku")}
          </label>
          <Input id="sku" name="sku" dir="ltr" defaultValue={data.sku} placeholder={t("searchSku")} maxLength={64} className="max-w-60" />
          <Button type="submit" variant="outline">
            {t("search")}
          </Button>
        </form>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-inventory-empty">
            {t("overviewEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-inventory-table">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pe-3 text-start font-medium">{t("columns.product")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("columns.sku")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("columns.location")}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t("columns.onHand")}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t("columns.reserved")}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t("columns.available")}</th>
                  <th className="py-1 text-end font-medium">{t("columns.updated")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((r, i) => (
                  <tr key={i} data-testid="admin-inventory-row">
                    <td className="py-1.5 pe-3">
                      <Link href={`/admin/products/${r.variant.product.id}`} className="hover:underline">
                        {title(r.variant.product.translations)}
                      </Link>
                    </td>
                    <td className="py-1.5 pe-3" dir="ltr">
                      {r.variant.sku}
                    </td>
                    <td className="py-1.5 pe-3" dir="ltr">{`${r.warehouse.code} / ${r.location.code}`}</td>
                    <td className="py-1.5 pe-3 text-end tabular-nums">{n(r.onHand)}</td>
                    <td className="py-1.5 pe-3 text-end tabular-nums">{n(r.reserved)}</td>
                    <td className="py-1.5 pe-3 text-end font-medium tabular-nums">{n(available(r))}</td>
                    <td className="py-1.5 text-end text-xs text-muted-foreground">{formatDate(r.updatedAt, loc, { dateStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.limited ? <p className="mt-2 text-xs text-muted-foreground">{t("overviewLimited")}</p> : null}
          </div>
        )}
      </Card>
    </>
  );
}
