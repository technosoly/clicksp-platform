"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateBackupCodesAction } from "@/modules/identity/api/account-actions";
import type { ActionState } from "@/modules/identity/api/admin-action";

/**
 * New backup codes from My account. Needs a current code from the
 * authenticator app; the new codes are shown once and replace the old ones.
 */
export function BackupCodesForm({ left }: { left: number }) {
  const t = useTranslations("AdminAccount");
  const locale = useLocale();
  const [state, action, pending] = useActionState<ActionState, FormData>(regenerateBackupCodesAction, {});

  if (state.ok && state.backupCodes) {
    return (
      <div className="space-y-3" data-testid="new-backup-codes">
        <p className="text-sm font-medium">{t("backupCodesNew")}</p>
        <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm">
          {state.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
          {t("backupCodesPrint")}
        </Button>
      </div>
    );
  }

  const errorKey = state.error ? `errors.${state.error}` : null;
  return (
    <form action={action} className="space-y-3" noValidate data-testid="backup-codes-form">
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm" data-testid="backup-codes-left">
        {t("backupCodesLeft", { count: left })}
      </p>
      {errorKey ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="form-error">
          {t.has(errorKey) ? t(errorKey, state.values) : t("errors.unexpected")}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="backup-code-totp">{t("backupCodesAppCode")}</Label>
        <Input
          id="backup-code-totp"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          dir="ltr"
          maxLength={6}
          className="max-w-40 text-center tracking-widest"
        />
      </div>
      <Button type="submit" disabled={pending} aria-disabled={pending} data-testid="backup-codes-submit">
        {t("backupCodesGenerate")}
      </Button>
    </form>
  );
}
