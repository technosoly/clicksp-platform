import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { addToCart } from "@/modules/sales/service/cart";
import { myOrder, placeOrder } from "@/modules/sales/service/checkout";
import { fulfilOrder } from "@/modules/sales/service/fulfilment";
import { orderForAdmin } from "@/modules/sales/service/orders-admin";
import { shipmentsOfOrder } from "@/modules/shipping/service/shipments";
import { actorFor, q } from "./admin-actors";
import { address, customer, ok, part, setup } from "./order-fixtures";

afterAll(async () => {
  await prisma().$disconnect();
});

/** A placed order marked paid with a succeeded payment row (as a gateway would leave it). */
async function paidOrder(quantity = 2) {
  const { methodId, locationId } = await setup();
  const p = await part(5);
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
  const [w] = await q<{ warehouse_id: string }>("SELECT warehouse_id FROM warehouse_locations WHERE id = $1", [locationId]);
  return { c, number, order, variantId: p.variantId, locationId, warehouseId: w!.warehouse_id };
}

const balance = async (variantId: string, locationId: string) =>
  (await q<{ on_hand: number; reserved: number }>("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = $1 AND location_id = $2", [variantId, locationId]))[0];

describe("packing and shipping paid orders", () => {
  it("packs, ships with a tracking code and delivers, taking the stock off the shelf once", async () => {
    const { c, number, order, variantId, locationId, warehouseId } = await paidOrder(2);
    const staff = await actorFor("store_staff", [], [warehouseId]);
    expect(await balance(variantId, locationId)).toEqual({ on_hand: 5, reserved: 2 });

    expect((await orderForAdmin(staff, number))!.fulfilStep).toBe("pack");
    expect(await fulfilOrder(staff, number, "ship")).toEqual({ status: "wrong_status" });
    ok(await fulfilOrder(staff, number, "pack"));
    expect(await fulfilOrder(staff, number, "pack")).toEqual({ status: "wrong_status" });
    expect(await fulfilOrder(staff, number, "ship", { trackingCode: "x!" })).toEqual({ status: "invalid", field: "invalid_tracking" });

    ok(await fulfilOrder(staff, number, "ship", { trackingCode: "ir-1234 5678" }));
    expect(await balance(variantId, locationId)).toEqual({ on_hand: 3, reserved: 0 });
    expect(await q("SELECT type, quantity, reference_type FROM inventory_movements WHERE reference_id = $1", [order.id])).toEqual([{ type: "sale", quantity: 2, reference_type: "order" }]);
    expect(await q("SELECT status FROM stock_reservations WHERE order_id = $1", [order.id])).toEqual([{ status: "consumed" }]);
    const shipments = await shipmentsOfOrder(order.id);
    expect(shipments).toMatchObject([{ status: "picked_up", trackingCode: "IR12345678" }]);
    expect(await q("SELECT quantity FROM shipment_items WHERE shipment_id = $1", [shipments[0]!.id])).toEqual([{ quantity: 2 }]);
    expect((await myOrder(c, number))!.status).toBe("shipped");

    ok(await fulfilOrder(staff, number, "deliver"));
    expect((await myOrder(c, number))!.status).toBe("delivered");
    expect((await shipmentsOfOrder(order.id))[0]!.status).toBe("delivered");
    expect((await orderForAdmin(staff, number))!.fulfilStep).toBeNull();
    expect(await fulfilOrder(staff, number, "deliver")).toEqual({ status: "wrong_status" });
    // Stock left once, even after every step was tried again.
    expect(await balance(variantId, locationId)).toEqual({ on_hand: 3, reserved: 0 });

    const history = await q<{ to_status: string; actor_user_id: string }>("SELECT to_status, actor_user_id FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id", [order.id]);
    expect(history.map((h) => h.to_status)).toEqual(["pending_payment", "paid", "processing", "shipped", "delivered"]);
    expect(history.slice(2).every((h) => h.actor_user_id === staff.userId)).toBe(true);
    expect((await q<{ topic: string }>("SELECT topic FROM outbox_events WHERE aggregate_id = $1 ORDER BY seq", [order.id])).map((r) => r.topic)).toEqual(["order.placed", "order.shipped", "order.delivered"]);
    expect((await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id", [order.id])).map((r) => r.action)).toEqual(["order.processing", "order.shipped", "order.delivered"]);
  });

  it("ships an order once when two people press ship at the same time", async () => {
    const { number, order, variantId, locationId } = await paidOrder(2);
    const ba = await actorFor("business_admin");
    ok(await fulfilOrder(ba, number, "pack"));
    const results = await Promise.all([fulfilOrder(ba, number, "ship"), fulfilOrder(await actorFor("super_admin"), number, "ship")]);
    expect(results.map((r) => r.status).sort()).toEqual(["ok", "wrong_status"]);
    expect(await balance(variantId, locationId)).toEqual({ on_hand: 3, reserved: 0 });
    expect(await shipmentsOfOrder(order.id)).toHaveLength(1);
    expect(await q("SELECT reference_code FROM inventory_movements WHERE reference_id = $1", [order.id])).toEqual([{ reference_code: number }]);
  });

  it("refuses to ship when the held stock doesn't match the order, and changes nothing", async () => {
    const { number, order, variantId, locationId } = await paidOrder(2);
    const ba = await actorFor("business_admin");
    ok(await fulfilOrder(ba, number, "pack"));
    // Bad data: the hold went away (as a manual fix or a future bug might do).
    await q("UPDATE stock_reservations SET status = 'released' WHERE order_id = $1", [order.id]);
    expect(await fulfilOrder(ba, number, "ship")).toEqual({ status: "stock_mismatch" });
    expect(await balance(variantId, locationId)).toEqual({ on_hand: 5, reserved: 0 });
    expect(await shipmentsOfOrder(order.id)).toEqual([]);
    expect(await q("SELECT status FROM orders WHERE id = $1", [order.id])).toEqual([{ status: "processing" }]);
  });

  it("refuses Store Staff outside the order's warehouses and orders that aren't paid", async () => {
    const { number, warehouseId } = await paidOrder(1);
    const other = await actorFor("store_staff", [], [(await q<{ id: string }>("INSERT INTO warehouses (code, name) VALUES ($1, 'TEST') RETURNING id", [`F-${Date.now()}`]))[0]!.id]);
    expect(await fulfilOrder(other, number, "pack")).toEqual({ status: "not_found" });
    const unscopedStaff = await actorFor("store_staff");
    await expect(fulfilOrder(unscopedStaff, number, "pack")).resolves.toEqual({ status: "not_found" });
    expect(await q("SELECT 1 FROM security_events WHERE user_id = $1 AND type = 'authz.denied'", [other.userId])).toHaveLength(1);

    const ba = await actorFor("business_admin");
    ok(await fulfilOrder(ba, number, "pack"));
    expect((await orderForAdmin(await actorFor("store_staff", [], [warehouseId]), number))!.fulfilStep).toBe("ship");

    // An order that awaits payment can't be packed.
    const { methodId } = await setup();
    const p = await part(2);
    const c = await customer();
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    const unpaid = ok(await placeOrder(c, address(methodId), "fa")).orderNumber.toString();
    expect(await fulfilOrder(ba, unpaid, "pack")).toEqual({ status: "wrong_status" });
    expect((await orderForAdmin(ba, unpaid))!.fulfilStep).toBeNull();
    await expect(fulfilOrder({ ...ba, kind: "customer" } as never, unpaid, "pack")).rejects.toBeInstanceOf(AuthzError);
  });
});
