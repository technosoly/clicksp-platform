import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { redirect } from "@/lib/i18n/navigation";
import { currentAdmin } from "@/modules/identity/api/admin-guard";

export default async function AdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await currentAdmin();
  if (admin?.mfa === "ok") redirect({ href: "/admin", locale });
  const t = await getTranslations("AdminAuth");
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-bold" data-testid="admin-login-heading">
          {t("loginTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("loginSubtitle")}</p>
      </div>
      <AdminLoginForm />
    </div>
  );
}
