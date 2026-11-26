import { getTranslations, setRequestLocale } from "next-intl/server";
import { SetPasswordForm } from "@/components/admin/set-password-form";

/**
 * Opens from a one-time link (new admin invitation or password reset). The
 * token is in the URL fragment (#...), which browsers never send to the
 * server, so it stays out of access logs and Referer headers.
 */
export default async function SetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AdminAuth");
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-bold" data-testid="set-password-heading">
          {t("setPasswordTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("setPasswordSubtitle")}</p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
