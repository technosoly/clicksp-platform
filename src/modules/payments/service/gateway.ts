import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import type { RequestMeta } from "@/lib/http/request-meta";
import { logger } from "@/lib/logger";
import { countRecentSecurityEvents, recordAudit, recordSecurityEvent } from "@/modules/audit/service/audit";
import type { CurrentCustomer } from "@/modules/identity/service/current-customer";
import { myOrder } from "@/modules/sales/service/checkout";
import { lockPayableOrder, orderReturnInfo, paymentInProgress, payOrder } from "@/modules/sales/service/order-payment";
import { loadAdapter } from "../adapters/registry";
import { isAllowedRedirect, MAX_PAYMENT_ATTEMPTS, OUR_REFERENCE, type GatewayCallback, type PaymentGatewayAdapter } from "../domain/gateway";
import {
  attemptByReference,
  attemptCount,
  claimForVerification,
  insertAttempt,
  insertOutboxEvent,
  isUniqueViolation,
  listProviders,
  lockAttempt,
  logCallback,
  markFinal,
  markRedirected,
  markSucceeded,
  orderPayments,
  providerByCode,
} from "../repo/payment-repo";

/**
 * Online payment through a gateway adapter (skill iranian-ecommerce):
 * 1. The customer starts a payment for their own unpaid order: an attempt row
 *    (initiated, amount = the order's total from the database) is written,
 *    the adapter returns the bank page, the row becomes redirected.
 * 2. The gateway sends the customer back to our callback. Only a server-to-
 *    server verify() decides that money moved, and only for the exact amount.
 * 3. One transaction then marks the attempt succeeded and the order paid and
 *    writes payment.succeeded and order.paid to the outbox (accounting, SMS).
 * A replayed callback finds the attempt already claimed or final and changes
 * nothing. If the order stopped awaiting payment meanwhile, verify() is never
 * called, so the gateway gives the money back by itself.
 */

/** Gateways a customer can pay with right now (active row and usable adapter). */
async function activeGateways(): Promise<{ provider: Awaited<ReturnType<typeof listProviders>>[number]; adapter: PaymentGatewayAdapter }[]> {
  const rows = await listProviders(db());
  return rows.flatMap((provider) => {
    if (!provider.isActive) return [];
    const adapter = loadAdapter(provider);
    return adapter ? [{ provider, adapter }] : [];
  });
}

/** What the customer's order page shows about paying for one of their orders. */
export async function myOrderPayments(customer: CurrentCustomer, orderNumber: string) {
  const order = await myOrder(customer, orderNumber);
  if (!order) return null;
  const [gateways, payments] = await Promise.all([order.status === "pending_payment" ? activeGateways() : Promise.resolve([]), orderPayments(db(), order.id)]);
  return {
    gateways: payments.length < MAX_PAYMENT_ATTEMPTS ? gateways.map((g) => g.provider.code) : [],
    payments: payments.map((p) => ({ id: p.id, status: p.status, at: p.initiatedAt, reference: p.status === "succeeded" ? p.providerReference : null })),
  };
}

export type StartPaymentResult =
  | { status: "ok"; redirectUrl: string }
  | { status: "not_found" | "not_payable" | "unavailable" | "too_many_attempts" | "payment_in_progress" | "gateway_error" };

/** Starts an online payment for the customer's own unpaid order; returns the bank page to send them to. */
export async function startOnlinePayment(customer: CurrentCustomer, orderNumber: string, providerCode: string): Promise<StartPaymentResult> {
  const order = await myOrder(customer, orderNumber);
  if (!order) return { status: "not_found" };
  const gateway = (await activeGateways()).find((g) => g.provider.code === providerCode);
  if (!gateway) return { status: "unavailable" };

  const attempt = await transaction(async (tx) => {
    // The order lock serializes attempts for the same order.
    const payable = await lockPayableOrder(tx, order.id);
    if (!payable || payable.userId !== customer.userId) return "not_payable" as const;
    // A payment is being checked with the bank: no second one until it is decided.
    if (await paymentInProgress(tx, order.id)) return "payment_in_progress" as const;
    const count = await attemptCount(tx, order.id);
    if (count >= MAX_PAYMENT_ATTEMPTS) return "too_many_attempts" as const;
    const ourReference = `pay_${payable.orderNumber}_${randomBytes(8).toString("hex")}`;
    const id = await insertAttempt(tx, { orderId: order.id, providerId: gateway.provider.id, amount: payable.grandTotal, ourReference, idempotencyKey: `pay:${order.id}:${count + 1}` });
    return { id, ourReference, amount: payable.grandTotal, orderNumber: payable.orderNumber };
  });
  if (typeof attempt === "string") return { status: attempt };

  const appUrl = env().APP_URL;
  try {
    const started = await gateway.adapter.initiate({
      amountRial: attempt.amount,
      ourReference: attempt.ourReference,
      callbackUrl: new URL(`/api/webhooks/payments/${gateway.provider.code}`, appUrl).toString(),
      description: `Clicksp #${attempt.orderNumber}`,
      mobile: customer.phone,
    });
    if (!isAllowedRedirect(started.redirectUrl, gateway.adapter.redirectHosts, appUrl)) {
      await markFinal(db(), attempt.id, "failed", { code: "bad_redirect", message: null });
      logger.error("Payment gateway returned a redirect outside its hosts", { provider: gateway.provider.code });
      return { status: "gateway_error" };
    }
    await markRedirected(db(), attempt.id, started.providerToken);
    return { status: "ok", redirectUrl: started.redirectUrl };
  } catch (error) {
    await markFinal(db(), attempt.id, "failed", { code: "initiate_failed", message: null });
    logger.error("Starting an online payment failed", { provider: gateway.provider.code, error: String(error) });
    return { status: "gateway_error" };
  }
}

export type CallbackOutcome = { outcome: "paid" | "failed" | "cancelled" | "pending"; orderNumber: bigint; locale: string } | { outcome: "unknown" };

const outcomeOf = (status: string): "paid" | "failed" | "cancelled" | "pending" =>
  status === "succeeded" ? "paid" : status === "cancelled" ? "cancelled" : status === "failed" || status === "expired" ? "failed" : "pending";

/** Rejected callbacks one IP may cause in 10 minutes before we stop answering (and writing) at all. */
const MAX_REJECTED_CALLBACKS = 20;
const REJECTED = "payment.callback_rejected";

/** The callback's parameters as logged: a few short string values, never more. */
function sanitize(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 20)
      .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 200)]),
  );
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Handles the customer's return from the gateway (no session needed: the
 * attempt is found by our own reference and the gateway's token, and checked
 * with the gateway itself).
 */
export async function handleGatewayCallback(providerCode: string, request: Request, meta: RequestMeta, now = new Date()): Promise<CallbackOutcome> {
  // Unauthenticated: once an IP has caused enough rejections, answer nothing and write nothing.
  if ((await countRecentSecurityEvents(REJECTED, meta.ipAddress, new Date(now.getTime() - 10 * 60_000))) >= MAX_REJECTED_CALLBACKS) return { outcome: "unknown" };
  const reject = async (reason: string, details: Record<string, unknown> = {}): Promise<CallbackOutcome> => {
    await recordSecurityEvent(meta, { type: REJECTED, details: { reason, ...details } });
    return { outcome: "unknown" };
  };

  const provider = /^[a-z][a-z0-9_]{1,49}$/.test(providerCode) ? await providerByCode(db(), providerCode) : null;
  // Callbacks for attempts started before a gateway was switched off are still honoured.
  const adapter = provider ? loadAdapter(provider) : null;
  if (!provider || !adapter) return reject("unknown_provider");

  let callback: GatewayCallback;
  try {
    callback = await adapter.parseCallback(request);
  } catch {
    return reject("unreadable", { provider: provider.code });
  }
  const attempt = OUR_REFERENCE.test(callback.ourReference) ? await attemptByReference(db(), provider.id, callback.ourReference) : null;
  // The gateway's token must come back and match the one it gave us for this attempt.
  if (!attempt || !attempt.providerToken || !callback.providerToken || !sameToken(callback.providerToken, attempt.providerToken)) {
    return reject("unknown_reference", { provider: provider.code, known: Boolean(attempt) });
  }
  await logCallback(db(), { paymentTransactionId: attempt.id, providerCode: provider.code, payload: sanitize(callback.raw), ipAddress: meta.ipAddress });
  const order = await orderReturnInfo(attempt.orderId);
  if (!order) return { outcome: "unknown" };
  const back = (outcome: "paid" | "failed" | "cancelled" | "pending"): CallbackOutcome => ({ outcome, orderNumber: order.orderNumber, locale: order.locale });

  if (attempt.status !== "redirected") return back(outcomeOf(attempt.status));
  if (callback.status !== "ok") {
    await markFinal(db(), attempt.id, "cancelled", { code: "not_completed", message: null });
    return back("cancelled");
  }

  // With the order locked: is it still payable, and is no other payment of it being checked?
  // Only then is this attempt claimed, so one order never has two verifications at once.
  const claim = await transaction(async (tx) => {
    if (!(await lockPayableOrder(tx, attempt.orderId))) return "not_payable" as const;
    if (await paymentInProgress(tx, attempt.orderId)) return "busy" as const;
    return (await claimForVerification(tx, attempt.id)) ? ("claimed" as const) : ("taken" as const);
  });
  if (claim === "not_payable") {
    // Never verified, so the gateway returns the money by itself.
    await markFinal(db(), attempt.id, "failed", { code: "order_not_payable", message: null });
    return back("failed");
  }
  if (claim === "busy") return back("pending");
  if (claim === "taken") {
    const current = await attemptByReference(db(), provider.id, attempt.ourReference);
    return back(outcomeOf(current?.status ?? "verifying"));
  }

  let verified;
  try {
    verified = await adapter.verify({ amountRial: attempt.amount, providerToken: attempt.providerToken });
  } catch (error) {
    // Unknown result: the attempt stays "verifying" for reconciliation.
    logger.error("Verifying an online payment failed", { provider: provider.code, paymentId: attempt.id, error: String(error) });
    return back("pending");
  }
  if (!verified.ok) {
    await markFinal(db(), attempt.id, "failed", { code: verified.code, message: verified.message });
    return back("failed");
  }
  if (verified.paidAmountRial !== attempt.amount) {
    await refundDue(attempt.id, "amount_mismatch", verified.providerReference, meta, { expected: attempt.amount.toString(), paid: verified.paidAmountRial.toString() });
    return back("failed");
  }

  try {
    const result = await transaction(async (tx) => {
      const locked = await lockAttempt(tx, attempt.id);
      if (!locked || locked.status !== "verifying") return "failed" as const;
      const payable = await lockPayableOrder(tx, attempt.orderId);
      if (!payable || payable.grandTotal !== attempt.amount) return "not_payable" as const;
      await markSucceeded(tx, attempt.id, { providerReference: verified.providerReference, maskedCard: verified.maskedCard ?? null, now: new Date() });
      await payOrder(tx, payable.id, payable.userId, "online_payment");
      await recordAudit(tx, meta, {
        actorUserId: null,
        action: "payment.succeeded",
        entityType: "payment_transaction",
        entityId: attempt.id,
        after: { provider: provider.code, amount: attempt.amount.toString(), reference: verified.providerReference, orderNumber: payable.orderNumber.toString() },
      });
      await insertOutboxEvent(tx, {
        topic: "payment.succeeded",
        aggregateType: "payment_transaction",
        aggregateId: attempt.id,
        payload: { orderId: payable.id, orderNumber: payable.orderNumber.toString(), amount: attempt.amount.toString(), provider: provider.code },
        dedupeKey: `payment.succeeded:${attempt.id}`,
      });
      await insertOutboxEvent(tx, { topic: "order.paid", aggregateType: "order", aggregateId: payable.id, payload: { orderNumber: payable.orderNumber.toString() }, dedupeKey: `order.paid:${payable.id}` });
      return "paid" as const;
    });
    if (result === "not_payable") {
      await refundDue(attempt.id, "order_not_payable_after_verify", verified.providerReference, meta);
      return back("failed");
    }
    return back(result);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await refundDue(attempt.id, "reference_reused", verified.providerReference, meta);
    return back("failed");
  }
}

/**
 * The gateway took money we can't apply to the order (wrong amount, order
 * closed meanwhile, reused reference). The attempt is closed as failed with
 * the reason and the gateway's reference, and a payment.refund_required event
 * and a critical security event make sure someone returns the money.
 */
async function refundDue(paymentId: string, code: string, providerReference: string, meta: RequestMeta, details: Record<string, unknown> = {}): Promise<void> {
  await transaction(async (tx) => {
    await markFinal(tx, paymentId, "failed", { code, message: `refund_required ${providerReference}` });
    await insertOutboxEvent(tx, { topic: "payment.refund_required", aggregateType: "payment_transaction", aggregateId: paymentId, payload: { reason: code, providerReference }, dedupeKey: `payment.refund_required:${paymentId}` });
  });
  await recordSecurityEvent(meta, { type: "payment.refund_required", severity: "critical", details: { paymentId, reason: code, ...details } });
}
