import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createWarehouseAction } from "@/modules/inventory/api/inventory-actions";
import { listWarehousesForAdmin } from "@/modules/inventory/service/warehouses";
import { WarehouseFields } from "./fields";

export default async function AdminWarehousesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: warehouses } = await adminPage(locale, (actor) => listWarehousesForAdmin(actor), "/admin/warehouses");
  const t = await getTranslations("AdminInventory");

  return (
    <>
      <PageHeader title={t("warehousesTitle")} description={t("warehousesIntro")} testId="admin-warehouses-heading" />
      <Card>
        {warehouses.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-warehouses-empty">
            {t("warehousesEmpty")}
          </p>
        ) : (
          <ul className="divide-y" data-testid="admin-warehouses-list">
            {warehouses.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-warehouse-row">
                <Link href={`/admin/warehouses/${w.id}`} className="font-medium hover:underline">
                  <span dir="ltr">{w.code}</span> · {w.name}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {w.city ? <span>{w.city}</span> : null}
                  <span>{t("locationCount", { count: formatCount(w._count.locations, locale) })}</span>
                  {w.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("newWarehouse")} description={t("newWarehouseHelp")}>
        <ActionForm action={createWarehouseAction} submitLabel={t("create")} testId="admin-warehouse-create" namespace="AdminInventory">
          <WarehouseFields />
        </ActionForm>
      </Card>
    </>
  );
}
