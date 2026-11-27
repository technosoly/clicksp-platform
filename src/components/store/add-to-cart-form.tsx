"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/auth/submit-button";
import { Link } from "@/lib/i18n/navigation";
import { addToCartAction, type CartActionState } from "@/modules/sales/api/cart-actions";

/** Quantity and "add to cart" for one variant; the server checks price, limits and stock. */
export function AddToCartForm({ variantId, minQty, maxQty }: { variantId: string; minQty: number; maxQty: number | null }) {
  const t = useTranslations("Cart");
  const [state, action] = useActionState<CartActionState, FormData>(addToCartAction, {});
  return (
    <form action={action} className="space-y-2" data-testid="add-to-cart">
      <input type="hidden" name="variantId" value={variantId} />
      <div className="flex items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">{t("quantity")}</span>
          <input
            name="quantity"
            type="number"
            inputMode="numeric"
            min={minQty}
            max={Math.min(maxQty ?? 99, 99)}
            defaultValue={minQty}
            dir="ltr"
            className="h-11 w-20 rounded-md border border-input bg-background px-3"
            data-testid="add-to-cart-quantity"
          />
        </label>
        <div className="flex-1">
          <SubmitButton label={t("add")} pendingLabel={t("adding")} testId="add-to-cart-submit" />
        </div>
      </div>
      {state.ok ? (
        <p role="status" className="text-sm text-success" data-testid="add-to-cart-done">
          {t("added")}{" "}
          <Link href="/cart" className="font-semibold underline">
            {t("viewCart")}
          </Link>
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="add-to-cart-error">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.unexpected")}
        </p>
      ) : null}
    </form>
  );
}
