import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { updateZoneAction } from "@/modules/shipping/api/shipping-actions";
import { zoneForAdmin } from "@/modules/shipping/service/shipping-admin";
import { ZoneFields } from "../../fields";

export default async function AdminShippingZonePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data: zone } = await adminPage(locale, (actor) => zoneForAdmin(actor, id), `/admin/shipping/zones/${id}`);
  if (!zone) notFound();
  const t = await getTranslations("AdminShipping");
  return (
    <>
      <PageHeader title={zone.code} description={t("zoneEditIntro")} testId="admin-shipping-zone-heading" actions={<Link href="/admin/shipping" className="text-sm underline">{t("back")}</Link>} />
      <Card>
        <ActionForm action={updateZoneAction} submitLabel={t("save")} testId="admin-shipping-zone-edit" namespace="AdminShipping">
          <input type="hidden" name="zoneId" value={zone.id} />
          <ZoneFields z={zone} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={zone.isActive} />
            {t("fields.isActive")}
          </label>
        </ActionForm>
      </Card>
    </>
  );
}
