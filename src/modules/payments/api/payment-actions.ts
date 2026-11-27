"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { logger } from "@/lib/logger";
import { startOnlinePayment } from "../service/gateway";
import { setGatewayActive } from "../service/payments-admin";

/** Server Actions for payments; the services authorize every call. */

export async function setGatewayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const on = text(form, "isActive") === "on";
    const result = await setGatewayActive(actor, text(form, "key"), on);
    return result.status === "ok" ? { ok: true, message: on ? "activated" : "deactivated" } : { error: result.status };
  });
}

/** What the pay button gets back: the bank page to open, or a key under Orders.pay.errors. */
export interface PayState {
  redirectUrl?: string;
  error?: string;
}

/** The customer starts paying for their own order; the customer comes from the session only. */
export async function startPaymentAction(_prev: PayState, form: FormData): Promise<PayState> {
  const customer = await currentCustomer();
  if (!customer) return { error: "signed_out" };
  try {
    const result = await startOnlinePayment(customer, text(form, "orderNumber"), text(form, "provider"));
    return result.status === "ok" ? { redirectUrl: result.redirectUrl } : { error: result.status };
  } catch (error) {
    logger.error("starting a payment failed", { error: String(error) });
    return { error: "unexpected" };
  }
}
