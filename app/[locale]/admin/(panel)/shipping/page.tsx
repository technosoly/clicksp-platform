import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createMethodAction, createZoneAction } from "@/modules/shipping/api/shipping-actions";
import { provinceName } from "@/modules/shipping/domain/provinces";
import { shippingOverview } from "@/modules/shipping/service/shipping-admin";
import { MethodFields, ZoneFields } from "./fields";

export default async function AdminShippingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => shippingOverview(actor), "/admin/shipping");
  const t = await getTranslations("AdminShipping");
  const name = (rows: { locale: string; name: string }[]) => (rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "fa"))?.name ?? "";

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-shipping-heading" />
      <Card title={t("methodsTitle")} description={t("methodsHelp")} testId="admin-shipping-methods">
        {data.methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("methodsEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {data.methods.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-shipping-method-row">
                <Link href={`/admin/shipping/methods/${m.id}`} className="font-medium hover:underline">
                  {name(m.translations)} <span dir="ltr" className="text-xs text-muted-foreground">{m.code}</span>
                </Link>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{t(`kinds.${m.kind}`)}</span>
                  <span>{t("rateCount", { count: formatCount(m._count.rates, locale) })}</span>
                  {m.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("newMethod")}>
        <ActionForm action={createMethodAction} submitLabel={t("create")} testId="admin-shipping-method-create" namespace="AdminShipping">
          <MethodFields />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>
      <Card title={t("zonesTitle")} description={t("zonesHelp")} testId="admin-shipping-zones">
        {data.zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("zonesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {data.zones.map((z) => (
              <li key={z.id} className="space-y-1 py-2" data-testid="admin-shipping-zone-row">
                <Link href={`/admin/shipping/zones/${z.id}`} className="font-medium hover:underline">
                  {name(z.translations)} <span dir="ltr" className="text-xs text-muted-foreground">{z.code}</span>
                </Link>
                {z.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                <p className="text-xs text-muted-foreground">{z.regions.map((r) => provinceName(r.provinceCode, locale)).join(locale === "fa" ? "، " : ", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("newZone")}>
        <ActionForm action={createZoneAction} submitLabel={t("create")} testId="admin-shipping-zone-create" namespace="AdminShipping">
          <ZoneFields />
        </ActionForm>
      </Card>
    </>
  );
}
