import { getTranslations, setRequestLocale } from "next-intl/server";
import { MfaCodeForm } from "@/components/admin/mfa-code-form";
import { redirect } from "@/lib/i18n/navigation";
import { currentAdmin } from "@/modules/identity/api/admin-guard";

/** TOTP step of sign-in, and re-verification (step-up) for sensitive actions. */
export default async function AdminMfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await currentAdmin();
  if (!admin) redirect({ href: "/admin/login", locale });
  if (admin!.mfa === "setup") redirect({ href: "/admin/mfa/setup", locale });
  if (!admin!.mfaEnrolled) redirect({ href: "/admin", locale });
  const t = await getTranslations("AdminAuth");
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-bold" data-testid="admin-mfa-heading">
          {t("mfaTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("mfaSubtitle")}</p>
      </div>
      <MfaCodeForm />
    </div>
  );
}
