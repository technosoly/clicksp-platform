"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError } from "@/components/auth/form-error";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import { adminMfaSetupAction, type FormState } from "@/modules/identity/api/admin-actions";

export function MfaSetupForm({
  qrDataUrl,
  secret,
  alreadyEnabled = false,
}: {
  qrDataUrl: string;
  secret: string;
  alreadyEnabled?: boolean;
}) {
  const t = useTranslations("AdminAuth");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(adminMfaSetupAction, undefined);

  if (state?.backupCodes) {
    return (
      <div className="space-y-4" data-testid="backup-codes">
        <h2 className="text-lg font-bold">{t("backupCodesTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("backupCodesHelp")}</p>
        <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm">
          {state.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button asChild className="w-full">
          <Link href="/admin" data-testid="continue-to-admin">
            {t("continueToAdmin")}
          </Link>
        </Button>
      </div>
    );
  }

  if (alreadyEnabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm">{t("alreadyEnabled")}</p>
        <Button asChild className="w-full">
          <Link href="/admin">{t("continueToAdmin")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-2 ps-5 text-sm">
        <li>{t("setupStep1")}</li>
        <li>{t("setupStep2")}</li>
        <li>{t("setupStep3")}</li>
      </ol>
      <div className="flex flex-col items-center gap-3">
        {/* Generated on the server from our own data; a data: URL, no external request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt={t("qrAlt")} width={200} height={200} className="size-50 rounded-md bg-white p-2" />
        <details className="w-full text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("manualKey")}</summary>
          <code dir="ltr" data-testid="totp-secret" className="mt-2 block break-all rounded-md bg-muted p-2 text-center font-mono">
            {secret}
          </code>
        </details>
      </div>
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="locale" value={locale} />
        <FormError message={state?.error ? t(`errors.${state.error}`) : undefined} />
        <div className="space-y-2">
          <Label htmlFor="code">{t("setupCode")}</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required dir="ltr" maxLength={6} className="text-center text-lg tracking-widest" />
        </div>
        <SubmitButton label={t("enable")} pendingLabel={t("verifying")} testId="admin-mfa-setup-submit" />
      </form>
    </div>
  );
}
