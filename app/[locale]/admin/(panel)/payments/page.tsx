import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { adminPage } from "@/modules/identity/api/admin-page";
import { setGatewayAction } from "@/modules/payments/api/payment-actions";
import { gatewaysForAdmin } from "@/modules/payments/service/payments-admin";

export default async function AdminPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => gatewaysForAdmin(actor), "/admin/payments");
  const t = await getTranslations("AdminPayments");
  const name = (key: string) => (t.has(`gateways.${key}`) ? t(`gateways.${key}`) : key);

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-payments-heading" />
      <Card title={t("gatewaysTitle")} description={t("gatewaysHelp")} testId="admin-payments-gateways">
        {data.gateways.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-payments-none">
            {t("none")}
          </p>
        ) : (
          <ul className="divide-y">
            {data.gateways.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="admin-payments-gateway">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{name(g.key)}</span>
                  {g.isActive ? <Badge tone="success">{t("on")}</Badge> : <Badge>{t("off")}</Badge>}
                  {g.isSandbox ? <Badge tone="orange">{t("test")}</Badge> : null}
                  {g.available ? null : <Badge tone="danger">{t("notOnServer")}</Badge>}
                </span>
                {data.canConfigure && (g.available || g.isActive) ? (
                  <ActionForm action={setGatewayAction} submitLabel={g.isActive ? t("switchOff") : t("switchOn")} submitVariant="outline" testId={`admin-payments-toggle-${g.key}`} namespace="AdminPayments">
                    <input type="hidden" name="key" value={g.key} />
                    <input type="hidden" name="isActive" value={g.isActive ? "off" : "on"} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.canConfigure ? null : <p className="mt-3 text-sm text-muted-foreground">{t("superAdminOnly")}</p>}
      </Card>
      <Card title={t("connectTitle")}>
        <p className="text-sm text-muted-foreground">{t("connectHelp")}</p>
      </Card>
    </>
  );
}
