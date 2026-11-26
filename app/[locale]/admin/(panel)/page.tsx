import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ADMIN_NAV, visibleNav } from "@/components/admin/admin-nav";
import { Badge, Card } from "@/components/admin/admin-ui";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { requireAdmin } from "@/modules/identity/api/admin-guard";
import { getAdminProfile } from "@/modules/identity/service/admin-auth";
import { holds } from "@/modules/rbac/domain/authorize";

const LEVEL_KEYS: Record<number, string> = { 1: "superAdmin", 2: "businessAdmin", 3: "storeStaff" };

export default async function AdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { ctx } = await requireAdmin(locale);
  const profile = await getAdminProfile(ctx.session.userId);
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const levelKey = LEVEL_KEYS[ctx.level] ?? "storeStaff";
  const areas = visibleNav(ADMIN_NAV, (key) => holds(ctx.permissions, key))
    .flatMap((g) => g.items)
    .filter((i) => i.href !== "/admin");

  return (
    <>
      <section className="overflow-hidden rounded-xl border bg-secondary text-secondary-foreground">
        <div className="flex flex-col gap-1 p-5 sm:p-6">
          <p className="text-sm text-brand-cream/70">{t(`levels.${levelKey}`)}</p>
          <h1 className="text-2xl font-bold" data-testid="admin-dashboard-heading">
            {t("welcome", { name: profile?.name || profile?.username || "" })}
          </h1>
          <p className="text-brand-cream/80">{t(`levelIntro.${levelKey}`)}</p>
        </div>
        <div className="h-1 bg-brand-orange" />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("yourRole")}</p>
          <p className="mt-1 font-semibold" data-testid="admin-role">
            {t(`levels.${levelKey}`)}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("twoFactor")}</p>
          <p className="mt-1 font-semibold" data-testid="admin-mfa-status">
            {ctx.mfaEnrolled ? t("twoFactorOn") : t("twoFactorOff")}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("permissions")}</p>
          <p className="mt-1 font-semibold">{format.number(ctx.permissions.size)}</p>
        </div>
      </section>
      <Card title={t("yourAreas")} description={t("yourAreasHelp")}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-areas">
          {areas.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-3 text-sm font-medium hover:border-brand-orange hover:bg-accent/40">
                <span>{t(`nav.${item.labelKey}`)}</span>
                {item.ready ? <Badge tone="success">{t("ready")}</Badge> : <Badge>{t("soon")}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
        {profile?.lastLoginAt ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("signedInAt", { time: formatDate(profile.lastLoginAt, isLocale(locale) ? locale : "fa", { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        ) : null}
      </Card>
    </>
  );
}
