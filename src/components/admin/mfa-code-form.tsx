"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError } from "@/components/auth/form-error";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminMfaAction, type FormState } from "@/modules/identity/api/admin-actions";

export function MfaCodeForm() {
  const t = useTranslations("AdminAuth");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(adminMfaAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormError message={state?.error ? t(`errors.${state.error}`) : undefined} />
      <div className="space-y-2">
        <Label htmlFor="code">{t("mfaCode")}</Label>
        <Input
          id="code"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          required
          dir="ltr"
          maxLength={20}
          className="text-center text-lg tracking-widest"
        />
        <p className="text-sm text-muted-foreground">{t("mfaCodeHint")}</p>
      </div>
      <SubmitButton label={t("verify")} pendingLabel={t("verifying")} testId="admin-mfa-submit" />
    </form>
  );
}
