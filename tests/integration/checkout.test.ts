import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct, setProductStatus } from "@/modules/catalog/service/products";
import { createWarehouse, getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
import { recordMovement } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { addToCart, viewCart } from "@/modules/sales/service/cart";
import { checkoutShipping, expireUnpaidOrders, myOrder, myOrders, placeOrder } from "@/modules/sales/service/checkout";
import { addRate, createMethod, createZone } from "@/modules/shipping/service/shipping-admin";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

let shared: { ba: Actor; categoryId: string; locationId: string; methodId: string } | null = null;
async function setup() {
  if (shared) return shared;
  const ba = await actorFor("business_admin");
  const category = ok(await createCategory(ba, { ...testNames("دسته"), parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" }));
  const w = ok(await createWarehouse(ba, { code: `K-${uid()}`.toUpperCase().slice(0, 30), name: "TEST", city: "", address: "", phone: "", priority: "", isActive: true }));
  const locationId = (await getWarehouseForAdmin(ba, w.id))!.locations[0]!.id;
  const code = () => `t_${uid().toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const zone = ok(await createZone(ba, { code: code(), faName: "TEST اصفهان", enName: "", provinces: ["IR-10"], isActive: true }));
  const method = ok(await createMethod(ba, { code: code(), kind: "post", faName: "TEST پست", enName: "TEST post", faDescription: "", enDescription: "", minDays: "", maxDays: "", sortOrder: "", isActive: true }));
  // 30,000 Toman + 10,000 per started kg.
  ok(await addRate(ba, method.id, { zoneId: zone.id, baseAmount: "30000", perKgAmount: "10000", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" }));
  shared = { ba, categoryId: category.id, locationId, methodId: method.id };
  return shared;
}

async function part(stock: number, weightGrams = 600) {
  const { ba, categoryId, locationId } = await setup();
  const created = ok(
    await createProduct(ba, {
      faTitle: `TEST سفارش ${uid()}`,
      faSlug: "",
      faShort: "",
      enTitle: `TEST order ${uid()}`,
      enSlug: "",
      enShort: "",
      brandId: "",
      primaryCategoryId: categoryId,
      categoryIds: [],
      warrantyMonths: "",
      sku: `ORD-${uid()}`,
      price: "100000",
      compareAtPrice: "",
    }),
  );
  ok(await setProductStatus(ba, created.id, "active"));
  const [v] = await q<{ id: string }>("UPDATE product_variants SET weight_grams = $2 WHERE product_id = $1 RETURNING id", [created.id, weightGrams]);
  if (stock > 0) ok(await recordMovement(ba, created.id, { kind: "receive", variantId: v!.id, locationId, quantity: String(stock), reference: "", reason: "", adjustmentReason: "" }));
  return { productId: created.id, variantId: v!.id };
}

async function customer() {
  const phone = `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const [u] = await q<{ id: string }>("INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [phone]);
  return { userId: u!.id, phone, name: null };
}

const address = (methodId: string) => ({
  recipientName: "TEST گیرنده",
  phone: "۰۹۱۲۱۲۳۴۵۶۷",
  provinceCode: "IR-10",
  city: "اصفهان",
  addressLine: "TEST خیابان آزمایشی، کوچهٔ ۱",
  plaque: "۱۲",
  unit: "",
  postalCode: "۸۱۳۴۵-۶۷۸۹۰",
  shippingMethodId: methodId,
  note: "",
  saveAddress: true,
});

describe("checkout", () => {
  it("places an order: server prices, shipping by weight, stock held, cart closed", async () => {
    const { methodId } = await setup();
    const a = await part(5, 600);
    const b = await part(5, 600);
    const c = await customer();
    ok(await addToCart(c, { variantId: a.variantId, quantity: "2" }));
    ok(await addToCart(c, { variantId: b.variantId, quantity: "1" }));

    const options = await checkoutShipping(c, "en", "IR-10");
    // 1,800 g: 30,000 + 2 × 10,000 Toman = 500,000 Rial.
    expect(options.find((o) => o.methodId === methodId)).toMatchObject({ name: "TEST post", cost: 500_000n });
    expect(await checkoutShipping(c, "en", "IR-23")).toEqual([]);

    const placed = ok(await placeOrder(c, address(methodId), "fa"));
    const order = await myOrder(c, placed.orderNumber.toString());
    expect(order).toMatchObject({ status: "pending_payment", subtotal: 3_000_000n, shippingTotal: 500_000n, grandTotal: 3_500_000n });
    expect(order!.items.map((i) => [i.quantity, i.unitPrice, i.lineTotal])).toEqual([
      [2, 1_000_000n, 2_000_000n],
      [1, 1_000_000n, 1_000_000n],
    ]);
    expect(order!.addresses[0]).toMatchObject({ phone: "+989121234567", postalCode: "8134567890", provinceCode: "IR-10", province: "اصفهان", plaque: "12", unit: null });

    const reserved = await q<{ variant_id: string; qty: number }>("SELECT variant_id, sum(quantity)::int AS qty FROM stock_reservations WHERE order_id = $1 AND status = 'active' GROUP BY variant_id", [order!.id]);
    expect(new Map(reserved.map((r) => [r.variant_id, r.qty]))).toEqual(new Map([[a.variantId, 2], [b.variantId, 1]]));
    const [history] = await q<{ to_status: string; actor_user_id: string }>("SELECT to_status, actor_user_id FROM order_status_history WHERE order_id = $1", [order!.id]);
    expect(history).toEqual({ to_status: "pending_payment", actor_user_id: c.userId });
    expect(await q("SELECT topic FROM outbox_events WHERE aggregate_id = $1", [order!.id])).toEqual([{ topic: "order.placed" }]);
    expect(await q("SELECT 1 FROM delivery_addresses WHERE user_id = $1 AND is_default", [c.userId])).toHaveLength(1);
    expect((await viewCart(c, "fa")).lines).toEqual([]);

    // A second submit of the same checkout finds nothing to order.
    expect(await placeOrder(c, address(methodId), "fa")).toEqual({ status: "cart_empty" });
    expect((await myOrders(c)).map((o) => o.orderNumber)).toEqual([placed.orderNumber]);
  });

  it("keeps orders private to their customer", async () => {
    const { methodId } = await setup();
    const p = await part(3);
    const owner = await customer();
    ok(await addToCart(owner, { variantId: p.variantId, quantity: "1" }));
    const placed = ok(await placeOrder(owner, address(methodId), "fa"));
    const stranger = await customer();
    expect(await myOrder(stranger, placed.orderNumber.toString())).toBeNull();
    expect(await myOrders(stranger)).toEqual([]);
    expect(await myOrder(owner, "1 OR 1=1")).toBeNull();
  });

  it("refuses when stock went meanwhile, without keeping anything", async () => {
    const { ba, methodId, locationId } = await setup();
    const p = await part(2);
    const c = await customer();
    ok(await addToCart(c, { variantId: p.variantId, quantity: "2" }));
    ok(await recordMovement(ba, p.productId, { kind: "issue", variantId: p.variantId, locationId, quantity: "1", reference: "", reason: "TEST", adjustmentReason: "" }));
    expect(await placeOrder(c, address(methodId), "fa")).toEqual({ status: "cart_changed" });
    expect(await q("SELECT 1 FROM orders WHERE user_id = $1", [c.userId])).toEqual([]);
    expect((await viewCart(c, "fa")).lines).toHaveLength(1);
  });

  it("never sells the same unit twice when two customers check out at once", async () => {
    const { methodId } = await setup();
    const p = await part(2);
    const first = await customer();
    const second = await customer();
    ok(await addToCart(first, { variantId: p.variantId, quantity: "2" }));
    ok(await addToCart(second, { variantId: p.variantId, quantity: "2" }));
    const results = await Promise.all([placeOrder(first, address(methodId), "fa"), placeOrder(second, address(methodId), "fa")]);
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(["out_of_stock", "cart_changed"]).toContain(results.find((r) => r.status !== "ok")!.status);
    const [held] = await q<{ qty: number }>("SELECT coalesce(sum(quantity), 0)::int AS qty FROM stock_reservations WHERE variant_id = $1 AND status = 'active'", [p.variantId]);
    expect(held!.qty).toBe(2);
  });

  it("places one order for a double submit, and at most two unpaid orders per customer", async () => {
    const { methodId } = await setup();
    const p = await part(10);
    const c = await customer();
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    const both = await Promise.all([placeOrder(c, address(methodId), "fa"), placeOrder(c, address(methodId), "fa")]);
    expect(both.filter((r) => r.status === "ok")).toHaveLength(1);
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    ok(await placeOrder(c, address(methodId), "fa"));
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    expect(await placeOrder(c, address(methodId), "fa")).toEqual({ status: "too_many_open_orders" });
    expect(await q("SELECT 1 FROM orders WHERE user_id = $1", [c.userId])).toHaveLength(2);
    // The same address ticked "remember" three times is saved once.
    expect(await q("SELECT 1 FROM delivery_addresses WHERE user_id = $1 AND deleted_at IS NULL", [c.userId])).toHaveLength(1);
  });

  it("cancels an unpaid order when its hold runs out and gives the stock back", async () => {
    const { methodId } = await setup();
    const p = await part(1);
    const c = await customer();
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    const placed = ok(await placeOrder(c, address(methodId), "fa"));
    const order = (await myOrder(c, placed.orderNumber.toString()))!;
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await expireUnpaidOrders(later)).toBeGreaterThanOrEqual(1);
    expect((await myOrder(c, placed.orderNumber.toString()))!.status).toBe("cancelled");
    expect(await q("SELECT status FROM stock_reservations WHERE order_id = $1", [order.id])).toEqual([{ status: "expired" }]);
    const [history] = await q<{ reason: string }>("SELECT reason FROM order_status_history WHERE order_id = $1 AND to_status = 'cancelled'", [order.id]);
    expect(history!.reason).toBe("payment_window_expired");
    // The unit can be bought again.
    const next = await customer();
    ok(await addToCart(next, { variantId: p.variantId, quantity: "1" }));
    ok(await placeOrder(next, address(methodId), "fa"));
  });

  it("checks what the customer typed and the delivery choice", async () => {
    const { methodId } = await setup();
    const p = await part(3);
    const c = await customer();
    expect(await placeOrder(c, address(methodId), "fa")).toEqual({ status: "cart_empty" });
    ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    expect(await placeOrder(c, { ...address(methodId), postalCode: "123" }, "fa")).toEqual({ status: "invalid", field: "invalid_postal_code" });
    expect(await placeOrder(c, { ...address(methodId), phone: "021-1234" }, "fa")).toEqual({ status: "invalid", field: "invalid_phone" });
    expect(await placeOrder(c, { ...address(methodId), provinceCode: "IR-99" }, "fa")).toEqual({ status: "invalid", field: "invalid_province" });
    expect(await placeOrder(c, { ...address(methodId), provinceCode: "IR-23" }, "fa")).toEqual({ status: "shipping_unavailable" });
    expect(await placeOrder(c, { ...address("00000000-0000-4000-8000-000000000000") }, "fa")).toEqual({ status: "shipping_unavailable" });
  });
});
