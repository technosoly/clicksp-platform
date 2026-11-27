/**
 * Returns and refunds through the real services on PostgreSQL. Data is
 * synthetic (TEST ...).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { MfaRequiredError } from "@/modules/rbac/service/authorize";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { addToCart } from "@/modules/sales/service/cart";
import { myOrder, placeOrder } from "@/modules/sales/service/checkout";
import { fulfilOrder } from "@/modules/sales/service/fulfilment";
import { decideReturn, myOrderReturns, orderRefundsForAdmin, receiveReturn, refundOrder, requestReturn, returnForAdmin, returnsForAdmin } from "@/modules/sales/service/returns";
import { actorFor, q } from "./admin-actors";
import { address, customer, ok, part, setup } from "./order-fixtures";

afterAll(async () => {
  await prisma().$disconnect();
});

/** A placed order marked paid with a succeeded payment row (as a gateway would leave it). */
async function paidOrder(quantity = 3) {
  const { methodId, locationId } = await setup();
  const p = await part(10);
  const c = await customer();
  ok(await addToCart(c, { variantId: p.variantId, quantity: String(quantity) }));
  const number = ok(await placeOrder(c, address(methodId), "fa")).orderNumber.toString();
  const order = (await myOrder(c, number))!;
  const [provider] = await q<{ id: string }>(
    "INSERT INTO payment_providers (code, adapter_key) VALUES ('test_paid', 'test_paid') ON CONFLICT (code) DO UPDATE SET adapter_key = EXCLUDED.adapter_key RETURNING id",
  );
  const ref = `T${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await q(
    `INSERT INTO payment_transactions (order_id, provider_id, status, amount, our_reference, idempotency_key, provider_reference, verified_at)
     VALUES ($1, $2, 'succeeded', $3, $4, $4, $4, now())`,
    [order.id, provider!.id, order.grandTotal.toString(), ref],
  );
  await q("UPDATE orders SET status = 'paid' WHERE id = $1", [order.id]);
  return { c, number, order, variantId: p.variantId, locationId, itemId: order.items[0]!.id };
}

async function deliveredOrder(quantity = 3) {
  const o = await paidOrder(quantity);
  const ba = await actorFor("business_admin");
  ok(await fulfilOrder(ba, o.number, "pack"));
  ok(await fulfilOrder(ba, o.number, "ship"));
  ok(await fulfilOrder(ba, o.number, "deliver"));
  return { ...o, ba };
}

const onHand = async (variantId: string, locationId: string) =>
  (await q<{ on_hand: number }>("SELECT on_hand FROM inventory_balances WHERE variant_id = $1 AND location_id = $2", [variantId, locationId]))[0]?.on_hand ?? 0;
const status = async (orderId: string) => (await q<{ status: string }>("SELECT status::text FROM orders WHERE id = $1", [orderId]))[0]!.status;

describe("returns", () => {
  it("customer asks, admin approves, receives onto a shelf and refunds; the order follows", async () => {
    const { c, number, order, variantId, locationId, itemId, ba } = await deliveredOrder(3);
    expect(await onHand(variantId, locationId)).toBe(7);
    const view = await myOrderReturns(c, number);
    expect(view?.returnable).toEqual([{ orderItemId: itemId, max: 3 }]);

    expect(await requestReturn(c, number, { reason: "nope", note: "", quantities: { [itemId]: "1" } })).toEqual({ status: "invalid", field: "reason_required" });
    expect(await requestReturn(c, number, { reason: "defective", note: "", quantities: {} })).toEqual({ status: "invalid", field: "nothing_selected" });
    expect(await requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "4" } })).toEqual({ status: "too_much" });
    const asked = ok(await requestReturn(c, number, { reason: "defective", note: "TEST broken", quantities: { [itemId]: "۲" } }));
    expect(await status(order.id)).toBe("return_requested");
    // One open request at a time.
    expect(await requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "1" } })).toEqual({ status: "wrong_status" });
    // Another customer can't see or ask about this order.
    const stranger = await customer();
    expect(await myOrderReturns(stranger, number)).toBeNull();
    expect(await requestReturn(stranger, number, { reason: "defective", note: "", quantities: { [itemId]: "1" } })).toEqual({ status: "not_found" });

    const rn = asked.returnNumber!;
    expect((await returnsForAdmin(ba, "requested")).rows.some((r) => r.returnNumber.toString() === rn)).toBe(true);
    const detail = await returnForAdmin(ba, rn);
    expect(detail?.can).toEqual({ decide: true, receive: false, refund: false, close: false });
    expect(await receiveReturn(ba, rn, [])).toEqual({ status: "wrong_status" });
    ok(await decideReturn(ba, rn, "approve", ""));
    expect(await decideReturn(ba, rn, "approve", "")).toEqual({ status: "wrong_status" });

    const ret = (await returnForAdmin(ba, rn))!;
    const results = await Promise.all([
      receiveReturn(ba, rn, [{ itemId: ret.ret.items[0]!.id, restock: true, locationId, condition: "TEST ok" }]),
      receiveReturn(ba, rn, [{ itemId: ret.ret.items[0]!.id, restock: true, locationId, condition: "TEST ok" }]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["ok", "wrong_status"]);
    // Two units back on the shelf, once; part of the order came back, so it is delivered again.
    expect(await onHand(variantId, locationId)).toBe(9);
    expect(await q("SELECT type::text, quantity, reference_type::text FROM inventory_movements WHERE reference_id = $1", [ret.ret.id])).toEqual([{ type: "return", quantity: 2, reference_type: "order_return" }]);
    expect(await status(order.id)).toBe("delivered");

    const received = (await returnForAdmin(ba, rn))!;
    expect(received.can.refund).toBe(true);
    expect(received.suggestedRefund).toBe((order.items[0]!.lineTotal * 2n) / 3n);

    const key = randomUUID();
    const toman = (received.suggestedRefund / 10n).toString();
    const [first, second] = await Promise.all([
      refundOrder(ba, number, { amount: toman, method: "bank_transfer", reason: "TEST return", returnNumber: rn, idempotencyKey: key }),
      refundOrder(ba, number, { amount: toman, method: "bank_transfer", reason: "TEST return", returnNumber: rn, idempotencyKey: key }),
    ]);
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(await q("SELECT amount::text, status::text, method::text FROM order_refunds WHERE order_id = $1", [order.id])).toEqual([
      { amount: ((received.suggestedRefund / 10n) * 10n).toString(), status: "completed", method: "bank_transfer" },
    ]);
    expect((await returnForAdmin(ba, rn))!.ret.status).toBe("completed");
    expect((await q<{ topic: string }>("SELECT topic FROM outbox_events WHERE topic = 'refund.completed' AND payload->>'orderId' = $1", [order.id])).length).toBe(1);
    expect(await status(order.id)).toBe("delivered");

    // Refunds never add up to more than the order's total.
    const refundState = (await orderRefundsForAdmin(ba, order.id))!;
    const over = (refundState.remaining / 10n + 1n).toString();
    expect(await refundOrder(ba, number, { amount: over, method: "cash", reason: "TEST too much", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "too_much" });
  });

  it("the customer returns everything: the order becomes returned, then refunded in full", async () => {
    const { c, number, order, itemId, ba, variantId, locationId } = await deliveredOrder(2);
    const rn = ok(await requestReturn(c, number, { reason: "wrong_fitment", note: "", quantities: { [itemId]: "2" } })).returnNumber!;
    ok(await decideReturn(ba, rn, "approve", ""));
    const ret = (await returnForAdmin(ba, rn))!;
    // Not sellable: nothing goes back on the shelf.
    ok(await receiveReturn(ba, rn, [{ itemId: ret.ret.items[0]!.id, restock: false, locationId: "", condition: "TEST broken" }]));
    expect(await onHand(variantId, locationId)).toBe(8);
    expect(await status(order.id)).toBe("returned");
    const remaining = (await orderRefundsForAdmin(ba, order.id))!.remaining;
    ok(await refundOrder(ba, number, { amount: (remaining / 10n).toString(), method: "cash", reason: "TEST full", returnNumber: rn, idempotencyKey: randomUUID() }));
    expect(remaining % 10n).toBe(0n);
    expect(await status(order.id)).toBe("refunded");
    expect((await myOrderReturns(c, number))?.refunds).toHaveLength(1);
  });

  it("a rejected request gives the order back its delivered status; the window closes after seven days", async () => {
    const { c, number, order, itemId, ba } = await deliveredOrder(1);
    const rn = ok(await requestReturn(c, number, { reason: "changed_mind", note: "", quantities: { [itemId]: "1" } })).returnNumber!;
    expect(await decideReturn(ba, rn, "reject", "")).toEqual({ status: "invalid", field: "note_required" });
    ok(await decideReturn(ba, rn, "reject", "TEST used"));
    expect(await status(order.id)).toBe("delivered");
    expect((await myOrderReturns(c, number))?.returnable).toHaveLength(1);
    const later = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    expect((await myOrderReturns(c, number, later))?.closedReason).toBe("window");
    expect(await requestReturn(c, number, { reason: "changed_mind", note: "", quantities: { [itemId]: "1" } }, later)).toEqual({ status: "invalid", field: "window_closed" });
  });

  it("refunds a paid order that can't be sent and releases its stock", async () => {
    const { number, order, variantId, locationId } = await paidOrder(2);
    const ba = await actorFor("business_admin");
    // Amounts are typed in the display unit (Toman); test prices are whole Toman.
    expect(order.grandTotal % 10n).toBe(0n);
    const amount = (order.grandTotal / 10n).toString();
    ok(await refundOrder(ba, number, { amount, method: "bank_transfer", reason: "TEST out of stock", returnNumber: "", idempotencyKey: randomUUID() }));
    expect(await status(order.id)).toBe("refunded");
    expect(await q("SELECT status::text FROM stock_reservations WHERE order_id = $1", [order.id])).toEqual([{ status: "released" }]);
    expect(await onHand(variantId, locationId)).toBe(10);
    expect(await refundOrder(ba, number, { amount: "1", method: "cash", reason: "TEST again", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "wrong_status" });
  });

  it("refuses Store Staff, unpaid orders, and refunds without a fresh two-factor check", async () => {
    const { c, number, order, itemId, ba } = await deliveredOrder(1);
    const rn = ok(await requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "1" } })).returnNumber!;
    const staff = await actorFor("store_staff", [], []);
    await expect(returnsForAdmin(staff, null)).rejects.toBeInstanceOf(AuthzError);
    await expect(returnForAdmin(staff, rn)).rejects.toBeInstanceOf(AuthzError);
    await expect(decideReturn(staff, rn, "approve", "")).rejects.toBeInstanceOf(AuthzError);
    await expect(receiveReturn(staff, rn, [])).rejects.toBeInstanceOf(AuthzError);
    await expect(refundOrder(staff, number, { amount: "1", method: "cash", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(AuthzError);
    expect(await orderRefundsForAdmin(staff, order.id)).toBeNull();
    const stale = { ...ba, mfaVerifiedAt: new Date(Date.now() - 24 * 60 * 60_000) };
    await expect(refundOrder(stale, number, { amount: "1", method: "cash", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(MfaRequiredError);
    const customerActor = { ...ba, kind: "customer" as const };
    await expect(returnsForAdmin(customerActor, null)).rejects.toBeInstanceOf(AuthzError);

    // An order that was never paid can't be refunded.
    const { methodId } = await setup();
    const p = await part(3);
    const buyer = await customer();
    ok(await addToCart(buyer, { variantId: p.variantId, quantity: "1" }));
    const unpaid = ok(await placeOrder(buyer, address(methodId), "fa")).orderNumber.toString();
    expect(await refundOrder(ba, unpaid, { amount: "1", method: "cash", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "wrong_status" });
    // Unknown methods and amounts are refused.
    expect(await refundOrder(ba, number, { amount: "1", method: "gateway", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "invalid", field: "invalid_method" });
    expect(await refundOrder(ba, number, { amount: "-5", method: "cash", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "invalid", field: "invalid_amount" });
  });

  it("keeps the window from the first delivery, even after a rejection or a partial return", async () => {
    const { c, number, itemId, ba } = await deliveredOrder(3);
    const day = 24 * 60 * 60_000;
    const sixDays = new Date(Date.now() + 6 * day);
    const rn = ok(await requestReturn(c, number, { reason: "changed_mind", note: "", quantities: { [itemId]: "1" } }, sixDays)).returnNumber!;
    ok(await decideReturn(ba, rn, "reject", "TEST no"));
    const eightDays = new Date(Date.now() + 8 * day);
    expect(await requestReturn(c, number, { reason: "changed_mind", note: "", quantities: { [itemId]: "1" } }, eightDays)).toEqual({ status: "invalid", field: "window_closed" });

    // A partial return received doesn't reopen it either.
    const rn2 = ok(await requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "1" } })).returnNumber!;
    ok(await decideReturn(ba, rn2, "approve", ""));
    const item = (await returnForAdmin(ba, rn2))!.ret.items[0]!;
    ok(await receiveReturn(ba, rn2, [{ itemId: item.id, restock: false, locationId: "", condition: "" }]));
    expect(await requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "1" } }, eightDays)).toEqual({ status: "invalid", field: "window_closed" });
    // The request was audited with the customer as actor.
    expect(await q("SELECT 1 FROM audit_logs WHERE action = 'return.requested' AND actor_user_id = $1", [c.userId])).toHaveLength(2);
    // Closing without a refund works only for a received return.
    expect(await decideReturn(ba, rn, "close", "")).toEqual({ status: "wrong_status" });
    ok(await decideReturn(ba, rn2, "close", ""));
    expect((await returnForAdmin(ba, rn2))!.ret.status).toBe("completed");
  });

  it("one request wins when the customer sends two at once", async () => {
    const { c, number, itemId } = await deliveredOrder(2);
    const results = await Promise.all([
      requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "2" } }),
      requestReturn(c, number, { reason: "defective", note: "", quantities: { [itemId]: "2" } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["ok", "wrong_status"]);
  });

  it("refuses refunds that don't belong to the order, in the wrong state, or in a changed unit", async () => {
    const a = await deliveredOrder(1);
    const b = await deliveredOrder(1);
    const sa = await actorFor("super_admin");
    const key = randomUUID();
    ok(await refundOrder(sa, a.number, { amount: "۱۰۰", method: "cash", reason: "TEST goodwill", returnNumber: "", idempotencyKey: key }));
    expect(await q("SELECT amount::text FROM order_refunds WHERE order_id = $1", [a.order.id])).toEqual([{ amount: "1000" }]);
    // The same key on another order records nothing and says so.
    expect(await refundOrder(sa, b.number, { amount: "100", method: "cash", reason: "TEST reuse", returnNumber: "", idempotencyKey: key })).toEqual({ status: "invalid", field: "invalid" });
    expect(await q("SELECT 1 FROM order_refunds WHERE order_id = $1", [b.order.id])).toHaveLength(0);
    // A return of another order.
    const rn = ok(await requestReturn(a.c, a.number, { reason: "defective", note: "", quantities: { [a.itemId]: "1" } })).returnNumber!;
    expect(await refundOrder(sa, b.number, { amount: "100", method: "cash", reason: "TEST other", returnNumber: rn, idempotencyKey: randomUUID() })).toEqual({ status: "not_found" });
    // Far more than the order, even beyond what the database can hold.
    expect(await refundOrder(sa, b.number, { amount: "99999999999999999999999", method: "cash", reason: "TEST huge", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "too_much" });
    // The store switched from Toman to Rial while the form was open.
    expect(await refundOrder(sa, b.number, { amount: "100", method: "cash", reason: "TEST unit", returnNumber: "", idempotencyKey: randomUUID(), unit: "rial" })).toEqual({ status: "invalid", field: "unit_changed" });
    // A shipped order can't be refunded until it is delivered.
    const shipped = await paidOrder(1);
    ok(await fulfilOrder(sa, shipped.number, "pack"));
    ok(await fulfilOrder(sa, shipped.number, "ship"));
    expect(await refundOrder(sa, shipped.number, { amount: "100", method: "cash", reason: "TEST shipped", returnNumber: "", idempotencyKey: randomUUID() })).toEqual({ status: "wrong_status" });
    // The customer sees no admin names or notes of returns still in progress.
    const view = await myOrderReturns(a.c, a.number);
    expect(Object.keys(view!.returns[0]!).sort()).toEqual(["adminNote", "createdAt", "id", "returnNumber", "status"]);
  });
});
