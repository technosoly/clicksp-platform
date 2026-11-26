import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

/**
 * Admin passwords are reset by another admin (no email or SMS provider is
 * needed): a Super Admin issues a one-time link from the admin panel, or the
 * server owner runs `pnpm admin:reset-link`.
 */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AdminAuth");
  return (
    <div className="space-y-4" data-testid="forgot-password">
      <h1 className="text-xl font-bold">{t("forgotTitle")}</h1>
      <p className="text-sm">{t("forgotStaff")}</p>
      <p className="text-sm">{t("forgotOwner")}</p>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs" dir="ltr">
        pnpm admin:reset-link --username &lt;username&gt;
      </pre>
      <Link href="/admin/login" className="text-sm text-brand-orange-strong underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
