"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError } from "@/components/auth/form-error";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { phoneLoginAction, type OtpFormState } from "@/modules/identity/api/customer-actions";

/** Two steps: mobile number, then the SMS code. */
export function PhoneLoginForm() {
  const t = useTranslations("CustomerAuth");
  const locale = useLocale();
  const [state, action] = useActionState<OtpFormState, FormData>(phoneLoginAction, { step: "phone" });
  const error = state.error ? t(`errors.${state.error}`) : undefined;

  if (state.step === "phone") {
    return (
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="intent" value="request" />
        <FormError message={error} />
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="09xxxxxxxxx"
            defaultValue={state.phone ?? ""}
            required
            dir="ltr"
          />
        </div>
        <SubmitButton label={t("sendCode")} pendingLabel={t("sending")} testId="otp-request-submit" />
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="intent" value="verify" />
      <input type="hidden" name="phone" value={state.phone} />
      <p className="text-sm text-muted-foreground">
        {t("codeSent")}{" "}
        <span dir="ltr" className="font-semibold">
          {state.phone}
        </span>
      </p>
      <FormError message={error} />
      <div className="space-y-2">
        <Label htmlFor="code">{t("code")}</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          dir="ltr"
          className="text-center text-lg tracking-widest"
        />
      </div>
      <SubmitButton label={t("verify")} pendingLabel={t("verifying")} testId="otp-verify-submit" />
    </form>
  );
}
