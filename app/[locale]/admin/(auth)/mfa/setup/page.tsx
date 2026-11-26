import { getTranslations, setRequestLocale } from "next-intl/server";
import QRCode from "qrcode";
import { MfaSetupForm } from "@/components/admin/mfa-setup-form";
import { redirect } from "@/lib/i18n/navigation";
import { currentAdmin } from "@/modules/identity/api/admin-guard";
import { pendingMfaEnrolment, startMfaEnrolment } from "@/modules/identity/service/admin-auth";

/** First sign-in of an admin who must use two-factor: enrol an authenticator app. */
export default async function AdminMfaSetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await currentAdmin();
  if (!admin) redirect({ href: "/admin/login", locale });
  if (admin!.mfaEnrolled && admin!.mfa !== "ok") redirect({ href: "/admin/mfa", locale });
  const t = await getTranslations("AdminAuth");

  // After the confirm action (which sets the new session cookie) this page
  // renders again with MFA enrolled. The form stays at the same place in the
  // tree, so it keeps the one-time backup codes in its state and shows them.
  let qrDataUrl = "";
  let secret = "";
  if (!admin!.mfaEnrolled) {
    // Reuse the pending secret on reload so an already-scanned code keeps working.
    const enrolment = (await pendingMfaEnrolment(admin!)) ?? (await startMfaEnrolment(admin!));
    if (!enrolment) redirect({ href: "/admin/login", locale });
    secret = enrolment!.secret;
    qrDataUrl = await QRCode.toDataURL(enrolment!.uri, { margin: 1, width: 200, errorCorrectionLevel: "M" });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-bold" data-testid="admin-mfa-setup-heading">
          {t("setupTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("setupSubtitle")}</p>
      </div>
      <MfaSetupForm qrDataUrl={qrDataUrl} secret={secret} alreadyEnabled={admin!.mfaEnrolled} />
    </div>
  );
}
