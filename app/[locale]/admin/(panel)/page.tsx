import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { requireAdmin } from "@/modules/identity/api/admin-guard";
import { getAdminProfile } from "@/modules/identity/service/admin-auth";

const LEVEL_KEYS: Record<number, string> = { 1: "superAdmin", 2: "businessAdmin", 3: "storeStaff" };

export default async function AdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { ctx } = await requireAdmin(locale);
  const profile = await getAdminProfile(ctx.session.userId);
  const t = await getTranslations("Admin");
  const format = await getFormatter();

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5">
        <h1 className="text-2xl font-bold" data-testid="admin-dashboard-heading">
          {t("welcome", { name: profile?.name || profile?.username || "" })}
        </h1>
        <p className="mt-1 text-muted-foreground">{t("dashboardIntro")}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("yourRole")}</p>
          <p className="mt-1 font-semibold" data-testid="admin-role">
            {t(`levels.${LEVEL_KEYS[ctx.level] ?? "storeStaff"}`)}
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
      <section className="rounded-xl border bg-card p-5 text-sm">
        <h2 className="font-semibold">{t("nextTitle")}</h2>
        <p className="mt-1 text-muted-foreground">{t("nextBody")}</p>
        {profile?.lastLoginAt ? (
          <p className="mt-3 text-muted-foreground">
            {t("signedInAt", { time: formatDate(profile.lastLoginAt, isLocale(locale) ? locale : "fa", { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
