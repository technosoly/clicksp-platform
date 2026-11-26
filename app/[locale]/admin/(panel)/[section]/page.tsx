import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { UPCOMING_SECTIONS } from "@/components/admin/admin-nav";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { adminPage } from "@/modules/identity/api/admin-page";
import { authorizeAny } from "@/modules/rbac/service/authorize";

/**
 * Admin areas whose screens arrive in a later phase. Only admins whose
 * permissions open the area get here (others get 403); the page says plainly
 * that the area is not built yet.
 */
export default async function UpcomingSectionPage({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  setRequestLocale(locale);
  const item = UPCOMING_SECTIONS.get(section);
  if (!item) notFound();
  await adminPage(locale, (actor) => authorizeAny(actor, item.anyOf, section));
  const t = await getTranslations("Admin");
  return (
    <>
      <PageHeader title={t(`nav.${item.labelKey}`)} testId="admin-section-heading" actions={<Badge>{t("soon")}</Badge>} />
      <Card>
        <p className="text-muted-foreground" data-testid="admin-section-upcoming">
          {t(`upcoming.${item.labelKey}`)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t("upcomingNote")}</p>
      </Card>
    </>
  );
}
