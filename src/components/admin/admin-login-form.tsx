"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError } from "@/components/auth/form-error";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminLoginAction, type FormState } from "@/modules/identity/api/admin-actions";

export function AdminLoginForm() {
  const t = useTranslations("AdminAuth");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(adminLoginAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormError message={state?.error ? t(`errors.${state.error}`) : undefined} />
      <div className="space-y-2">
        <Label htmlFor="identifier">{t("identifier")}</Label>
        <Input id="identifier" name="identifier" autoComplete="username" required dir="ltr" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </div>
      <SubmitButton label={t("signIn")} pendingLabel={t("signingIn")} testId="admin-login-submit" />
    </form>
  );
}
