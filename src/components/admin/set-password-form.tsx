"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import type { ActionState } from "@/modules/identity/api/admin-action";
import { setPasswordFromLinkAction } from "@/modules/identity/api/account-actions";

/** Reads the one-time token from the URL fragment, then removes it from the address bar. */
export function SetPasswordForm() {
  const t = useTranslations("AdminAuth");
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [state, action] = useActionState<ActionState, FormData>(setPasswordFromLinkAction, {});

  useEffect(() => {
    const value = window.location.hash.slice(1);
    if (value) history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fragment exists only in the browser
    setToken(value);
  }, []);

  if (state.ok) {
    return (
      <div className="space-y-4" data-testid="set-password-done">
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {t("passwordSetDone")}
        </p>
        <Button asChild className="w-full">
          <Link href="/admin/login">{t("goToLogin")}</Link>
        </Button>
      </div>
    );
  }
  if (token === "") {
    return <FormError message={t("errors.invalid_link")} />;
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token ?? ""} />
      <FormError message={state.error ? (t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.unexpected")) : undefined} />
      <div className="space-y-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required dir="ltr" />
        <p className="text-xs text-muted-foreground">{t("passwordRules")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("confirmPassword")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required dir="ltr" />
      </div>
      <SubmitButton label={t("savePassword")} pendingLabel={t("saving")} testId="set-password-submit" />
    </form>
  );
}
