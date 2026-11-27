"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/auth/submit-button";
import { startPaymentAction, type PayState } from "@/modules/payments/api/payment-actions";

/**
 * Starts an online payment and opens the bank's page. The server decides the
 * amount; the browser only learns where to go. The page is opened from script
 * (not a form redirect) so the strict form-action policy stays 'self'.
 */
export function PayButton({ orderNumber, provider, label }: { orderNumber: string; provider: string; label: string }) {
  const t = useTranslations("Orders.pay");
  const [state, action] = useActionState<PayState, FormData>(startPaymentAction, {});
  useEffect(() => {
    if (state.redirectUrl) window.location.assign(state.redirectUrl);
  }, [state.redirectUrl]);
  return (
    <form action={action} className="space-y-2" data-testid="order-pay-form">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <input type="hidden" name="provider" value={provider} />
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="order-pay-error">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.unexpected")}
        </p>
      ) : null}
      <SubmitButton label={label} pendingLabel={state.redirectUrl ? t("opening") : t("starting")} testId="order-pay-submit" />
    </form>
  );
}
