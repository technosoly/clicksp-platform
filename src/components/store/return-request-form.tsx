"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestReturnAction, type ReturnRequestState } from "@/modules/sales/api/return-actions";
import { RETURN_REASONS } from "@/modules/sales/domain/returns";

export interface ReturnableLine {
  orderItemId: string;
  title: string;
  sku: string;
  max: number;
}

/** The customer picks units to send back and says why; the server checks every number again. */
export function ReturnRequestForm({ orderNumber, lines }: { orderNumber: string; lines: ReturnableLine[] }) {
  const t = useTranslations("Orders.returns");
  const [state, action] = useActionState<ReturnRequestState, FormData>(requestReturnAction, {});
  if (state.ok) {
    return (
      <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success" data-testid="return-requested">
        {t("requested")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3" noValidate data-testid="return-form">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <ul className="divide-y rounded-md border">
        {lines.map((l) => (
          <li key={l.orderItemId} className="flex items-center justify-between gap-3 p-2 text-sm">
            <Label htmlFor={`qty-${l.orderItemId}`} className="font-normal">
              {l.title} <span dir="ltr" className="text-xs text-muted-foreground">{l.sku}</span>
              <span className="block text-xs text-muted-foreground">{t("upTo", { count: l.max })}</span>
            </Label>
            <Input id={`qty-${l.orderItemId}`} name={`qty-${l.orderItemId}`} inputMode="numeric" defaultValue="" placeholder="0" className="h-9 w-20 text-end" />
          </li>
        ))}
      </ul>
      <div className="space-y-1">
        <Label htmlFor="return-reason">{t("reason")}</Label>
        <select id="return-reason" name="reason" required defaultValue="" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="" disabled>
            {t("chooseReason")}
          </option>
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="return-note">{t("note")}</Label>
        <Input id="return-note" name="note" maxLength={1000} />
      </div>
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="return-error">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.unexpected")}
        </p>
      ) : null}
      <SubmitButton label={t("submit")} pendingLabel={t("sending")} testId="return-submit" />
    </form>
  );
}
