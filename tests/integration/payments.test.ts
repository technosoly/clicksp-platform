import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { AuthzError, MfaRequiredError } from "@/modules/rbac/service/authorize";
import { handleGatewayCallback, myOrderPayments, startOnlinePayment } from "@/modules/payments/service/gateway";
import { gatewaysForAdmin, orderPaymentsForAdmin, setGatewayActive } from "@/modules/payments/service/payments-admin";
import { addToCart } from "@/modules/sales/service/cart";
import { expireUnpaidOrders, myOrder, placeOrder } from "@/modules/sales/service/checkout";
import { cancelOrderByAdmin } from "@/modules/sales/service/orders-admin";
import { actorFor, meta, q } from "./admin-actors";
import { address, customer, ok, part, setup } from "./order-fixtures";

afterAll(async () => {
  await prisma().$disconnect();
});

/** The fake gateway on, behaving as asked ("pay", "decline" or "underpay"). */
async function fakeGatewayOn(behaviour = "pay") {
  ok(await setGatewayActive(await actorFor("super_admin"), "fake", true));
  await q("UPDATE payment_providers SET config = $1 WHERE code = 'fake'", [JSON.stringify({ behaviour })]);
}

async function unpaidOrder() {
  const { methodId } = await setup();
  const p = await part(3);
  const c = await customer();
  ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
  const placed = ok(await placeOrder(c, address(methodId), "en"));
  const number = placed.orderNumber.toString();
  return { c, number, order: (await myOrder(c, number))! };
}

async function startAndReturn(c: Awaited<ReturnType<typeof customer>>, number: string) {
  const started = ok(await startOnlinePayment(c, number, "fake"));
  return { started, back: () => handleGatewayCallback("fake", new Request(started.redirectUrl), meta()) };
}

const topics = async (...ids: string[]) => (await q<{ topic: string }>("SELECT topic FROM outbox_events WHERE aggregate_id = ANY($1::uuid[]) ORDER BY seq", [ids])).map((r) => r.topic);

describe("payment settings", () => {
  it("only a Super Admin switches gateways; Business Admins see them; Store Staff are refused", async () => {
    const sa = await actorFor("super_admin");
    const ba = await actorFor("business_admin");
    const staff = await actorFor("store_staff");
    await expect(setGatewayActive(ba, "fake", true)).rejects.toBeInstanceOf(AuthzError);
    await expect(gatewaysForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(setGatewayActive({ ...sa, mfaVerifiedAt: null }, "fake", true)).rejects.toBeInstanceOf(MfaRequiredError);
    // Only gateways this server has can be switched on.
    expect(await setGatewayActive(sa, "zarinpal", true)).toEqual({ status: "not_found" });

    ok(await setGatewayActive(sa, "fake", true));
    expect((await gatewaysForAdmin(ba)).gateways.find((g) => g.key === "fake")).toEqual({ key: "fake", available: true, isActive: true, isSandbox: true });
    expect((await gatewaysForAdmin(ba)).canConfigure).toBe(false);
    expect(await q("SELECT 1 FROM audit_logs WHERE actor_user_id = $1 AND action = 'payment_provider.activated'", [sa.userId])).toHaveLength(1);
  });
});

describe("paying online", () => {
  beforeEach(async () => {
    await fakeGatewayOn();
  });

  it("pays the order once, for the amount in the database, whatever the callback says", async () => {
    const { c, number, order } = await unpaidOrder();
    expect((await myOrderPayments(c, number))!.gateways).toEqual(["fake"]);
    // Someone else's order looks like it doesn't exist.
    expect(await startOnlinePayment(await customer(), number, "fake")).toEqual({ status: "not_found" });
    expect(await startOnlinePayment(c, number, "zarinpal")).toEqual({ status: "unavailable" });

    const { started, back } = await startAndReturn(c, number);
    expect(new URL(started.redirectUrl).pathname).toBe("/api/webhooks/payments/fake");
    const [attempt] = await q<{ id: string; status: string; amount: string }>("SELECT id, status, amount FROM payment_transactions WHERE order_id = $1", [order.id]);
    expect(attempt).toMatchObject({ status: "redirected", amount: order.grandTotal.toString() });

    // The same callback twice at once: one payment, one set of events.
    const [first, second] = await Promise.all([back(), back()]);
    // The loser of the race sees the payment still being checked, or already paid.
    expect([first.outcome, second.outcome]).toContain("paid");
    for (const r of [first, second]) expect(["paid", "pending"]).toContain(r.outcome);
    expect(await back()).toEqual({ outcome: "paid", orderNumber: order.orderNumber, locale: "en" });
    expect((await myOrder(c, number))!.status).toBe("paid");
    expect(await topics(order.id, attempt!.id)).toEqual(["order.placed", "payment.succeeded", "order.paid"]);
    const [history] = await q<{ reason: string; actor_user_id: string }>("SELECT reason, actor_user_id FROM order_status_history WHERE order_id = $1 AND to_status = 'paid'", [order.id]);
    expect(history).toEqual({ reason: "online_payment", actor_user_id: c.userId });
    expect(await q("SELECT 1 FROM payment_callback_logs WHERE payment_transaction_id = $1", [attempt!.id])).toHaveLength(3);

    const ba = await actorFor("business_admin");
    expect((await orderPaymentsForAdmin(ba, order.id))![0]).toMatchObject({ status: "succeeded", maskedCard: "603799******0006" });
    expect(await orderPaymentsForAdmin(await actorFor("store_staff"), order.id)).toBeNull();
    // Paid: nothing more to pay, and the stock stays held for packing.
    expect(await startOnlinePayment(c, number, "fake")).toEqual({ status: "not_payable" });
    expect((await myOrderPayments(c, number))!.gateways).toEqual([]);
    expect(await q("SELECT 1 FROM stock_reservations WHERE order_id = $1 AND status = 'active'", [order.id])).toHaveLength(1);
  });

  it("keeps the order unpaid when the customer leaves the bank page or the bank declines", async () => {
    await fakeGatewayOn("decline");
    const { c, number, order } = await unpaidOrder();
    const { back } = await startAndReturn(c, number);
    expect((await back()).outcome).toBe("cancelled");
    expect((await myOrder(c, number))!.status).toBe("pending_payment");
    expect((await myOrderPayments(c, number))!.payments.map((p) => p.status)).toEqual(["cancelled"]);
    expect(await topics(order.id)).toEqual(["order.placed"]);
  });

  it("refuses a payment for the wrong amount and records it", async () => {
    await fakeGatewayOn("underpay");
    const { c, number, order } = await unpaidOrder();
    const { back } = await startAndReturn(c, number);
    expect((await back()).outcome).toBe("failed");
    expect((await myOrder(c, number))!.status).toBe("pending_payment");
    const [row] = await q<{ id: string; status: string; failure_code: string }>("SELECT id, status, failure_code FROM payment_transactions WHERE order_id = $1", [order.id]);
    expect(row).toMatchObject({ status: "failed", failure_code: "amount_mismatch" });
    // The money the bank took is owed back: an event for the refund, and an alert.
    expect(await topics(row!.id)).toEqual(["payment.refund_required"]);
    expect(await q("SELECT 1 FROM security_events WHERE type = 'payment.refund_required' AND details->>'paymentId' = $1::text", [row!.id])).toHaveLength(1);
  });

  it("rejects forged callbacks and never verifies for an order that was cancelled meanwhile", async () => {
    const { c, number, order } = await unpaidOrder();
    const { started, back } = await startAndReturn(c, number);
    const forged = new URL(started.redirectUrl);
    forged.searchParams.set("ref", "pay_1_0000000000000000");
    expect(await handleGatewayCallback("fake", new Request(forged), meta())).toEqual({ outcome: "unknown" });
    const wrongToken = new URL(started.redirectUrl);
    wrongToken.searchParams.set("token", "fake_000000000000000000000000");
    expect(await handleGatewayCallback("fake", new Request(wrongToken), meta())).toEqual({ outcome: "unknown" });
    expect(await handleGatewayCallback("nope", new Request(started.redirectUrl), meta())).toEqual({ outcome: "unknown" });

    ok(await cancelOrderByAdmin(await actorFor("business_admin"), number, "TEST customer asked"));
    expect((await back()).outcome).toBe("failed");
    const [row] = await q<{ status: string; failure_code: string }>("SELECT status, failure_code FROM payment_transactions WHERE order_id = $1", [order.id]);
    expect(row).toEqual({ status: "failed", failure_code: "order_not_payable" });
    expect((await myOrder(c, number))!.status).toBe("cancelled");
  });

  it("never takes two payments for one order, even when both come back at once", async () => {
    const { c, number, order } = await unpaidOrder();
    const a = await startAndReturn(c, number);
    const b = await startAndReturn(c, number);
    const outcomes = (await Promise.all([a.back(), b.back()])).map((r) => r.outcome);
    expect(outcomes).toContain("paid");
    expect(outcomes.filter((o) => o === "paid")).toHaveLength(1);
    const rows = await q<{ id: string; status: string; failure_code: string | null }>("SELECT id, status, failure_code FROM payment_transactions WHERE order_id = $1 ORDER BY initiated_at", [order.id]);
    expect(rows.filter((r) => r.status === "succeeded")).toHaveLength(1);
    // The other one was never verified (so the bank gives it back), and nothing is owed.
    expect(rows.find((r) => r.status !== "succeeded")!.status).not.toBe("verifying");
    expect(await q("SELECT 1 FROM outbox_events WHERE topic = 'payment.refund_required' AND aggregate_id = ANY($1::uuid[])", [rows.map((r) => r.id)])).toHaveLength(0);
  });

  it("keeps an order whose payment is being checked from expiring, being cancelled or paid twice", async () => {
    const { c, number, order } = await unpaidOrder();
    await startAndReturn(c, number);
    await q("UPDATE payment_transactions SET status = 'verifying' WHERE order_id = $1", [order.id]);
    // The stock hold has run out meanwhile.
    await q("UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1", [order.id]);
    await expireUnpaidOrders(new Date(), 500);
    expect((await myOrder(c, number))!.status).toBe("pending_payment");
    expect(await cancelOrderByAdmin(await actorFor("business_admin"), number, "TEST customer asked")).toEqual({ status: "payment_in_progress" });
    expect(await startOnlinePayment(c, number, "fake")).toEqual({ status: "payment_in_progress" });
  });

  it("stops answering an address that keeps sending forged callbacks", async () => {
    const { c, number } = await unpaidOrder();
    const { started, back } = await startAndReturn(c, number);
    const from = { ipAddress: "203.0.113.77", userAgent: "vitest", requestId: null };
    await q("DELETE FROM security_events WHERE ip_address = $1", [from.ipAddress]).catch(() => undefined);
    const forged = new URL(started.redirectUrl);
    forged.searchParams.set("token", "fake_000000000000000000000000");
    for (let n = 0; n < 20; n += 1) await handleGatewayCallback("fake", new Request(forged), from);
    const count = async () => (await q<{ n: number }>("SELECT count(*)::int AS n FROM security_events WHERE ip_address = $1 AND type = 'payment.callback_rejected'", [from.ipAddress]))[0]!.n;
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(20);
    // Even a real callback from that address is turned away until the window passes.
    expect(await handleGatewayCallback("fake", new Request(started.redirectUrl), from)).toEqual({ outcome: "unknown" });
    expect(await count()).toBe(before);
    expect((await back()).outcome).toBe("paid");
  });

  it("offers nothing when the gateway is off", async () => {
    const { c, number } = await unpaidOrder();
    ok(await setGatewayActive(await actorFor("super_admin"), "fake", false));
    expect((await myOrderPayments(c, number))!.gateways).toEqual([]);
    expect(await startOnlinePayment(c, number, "fake")).toEqual({ status: "unavailable" });
  });
});
