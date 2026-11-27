import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct, setProductStatus } from "@/modules/catalog/service/products";
import { createWarehouse, getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
import { recordMovement } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { MAX_CART_LINES } from "@/modules/sales/domain/cart-rules";
import { addToCart, cartCount, mergeGuestCart, updateCartLine, viewCart } from "@/modules/sales/service/cart";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

let shared: { ba: Actor; categoryId: string; locationId: string } | null = null;
async function setup() {
  if (shared) return shared;
  const ba = await actorFor("business_admin");
  const category = ok(await createCategory(ba, { ...testNames("دسته"), parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" }));
  const w = ok(await createWarehouse(ba, { code: `c-${uid()}`, name: "TEST", city: "", address: "", phone: "", priority: "", isActive: true }));
  const locationId = (await getWarehouseForAdmin(ba, w.id))!.locations[0]!.id;
  shared = { ba, categoryId: category.id, locationId };
  return shared;
}

/** A published part with `stock` units on hand. */
async function part(stock: number, publish = true) {
  const { ba, categoryId, locationId } = await setup();
  const created = ok(
    await createProduct(ba, {
      faTitle: `TEST سبد ${uid()}`,
      faSlug: "",
      faShort: "",
      enTitle: `TEST cart ${uid()}`,
      enSlug: "",
      enShort: "",
      brandId: "",
      primaryCategoryId: categoryId,
      categoryIds: [],
      warrantyMonths: "",
      sku: `CART-${uid()}`,
      price: "100000",
      compareAtPrice: "",
    }),
  );
  if (publish) ok(await setProductStatus(ba, created.id, "active"));
  const [v] = await q<{ id: string }>("SELECT id FROM product_variants WHERE product_id = $1", [created.id]);
  if (stock > 0) ok(await recordMovement(ba, created.id, { kind: "receive", variantId: v!.id, locationId, quantity: String(stock), reference: "", reason: "", adjustmentReason: "" }));
  return { productId: created.id, variantId: v!.id };
}

async function customer() {
  const [u] = await q<{ id: string }>("INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [`+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`]);
  return { userId: u!.id };
}

describe("cart", () => {
  it("starts a guest cart on the first add and prices it from the server", async () => {
    const p = await part(10);
    const first = ok(await addToCart(null, { variantId: p.variantId, quantity: "2" }));
    expect(first.newGuestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const owner = { guestToken: first.newGuestToken! };
    const [row] = await q<{ hash: string }>("SELECT guest_token_hash AS hash FROM carts c JOIN cart_items i ON i.cart_id = c.id WHERE i.variant_id = $1", [p.variantId]);
    expect(row!.hash).not.toBe(first.newGuestToken);

    ok(await addToCart(owner, { variantId: p.variantId, quantity: "3" }));
    const cart = await viewCart(owner, "fa");
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ quantity: 5, problem: null, lineTotal: 100000n * 10n * 5n });
    expect(cart.subtotal).toBe(5_000_000n);
    expect(cart.ready).toBe(true);
    expect(await cartCount(owner)).toBe(1);

    // A price change shows at once: the cart never stores prices.
    await q("UPDATE product_variants SET price = 2000000 WHERE id = $1", [p.variantId]);
    expect((await viewCart(owner, "fa")).subtotal).toBe(10_000_000n);
  });

  it("caps an add at the stock on hand and refuses parts that can't be bought", async () => {
    const p = await part(3);
    const added = ok(await addToCart(null, { variantId: p.variantId, quantity: "50" }));
    expect(added.quantity).toBe(3);
    expect(await addToCart(null, { variantId: (await part(0)).variantId, quantity: "1" })).toEqual({ status: "invalid", error: "out_of_stock" });
    expect(await addToCart(null, { variantId: (await part(5, false)).variantId, quantity: "1" })).toEqual({ status: "invalid", error: "unavailable" });
    expect(await addToCart(null, { variantId: "not-a-uuid", quantity: "1" })).toEqual({ status: "invalid", error: "invalid_input" });
    expect(await addToCart(null, { variantId: p.variantId, quantity: "0" })).toEqual({ status: "invalid", error: "invalid_input" });
    expect(await addToCart(null, { variantId: p.variantId, quantity: "1000" })).toEqual({ status: "invalid", error: "invalid_input" });
  });

  it("flags lines that can no longer be ordered as they are", async () => {
    const { ba } = await setup();
    const a = await part(2);
    const b = await part(5);
    const owner = { guestToken: ok(await addToCart(null, { variantId: a.variantId, quantity: "2" })).newGuestToken! };
    ok(await addToCart(owner, { variantId: b.variantId, quantity: "1" }));
    ok(await updateCartLine(owner, { variantId: a.variantId, quantity: "4" }));
    ok(await setProductStatus(ba, b.productId, "draft"));

    const cart = await viewCart(owner, "fa");
    expect(cart.lines.map((l) => l.problem)).toEqual(["not_enough_stock", "unavailable"]);
    expect(cart.lines[1]!.item).toBeNull();
    expect(cart.subtotal).toBe(0n);
    expect(cart.ready).toBe(false);

    ok(await updateCartLine(owner, { variantId: b.variantId, quantity: "0" }));
    ok(await updateCartLine(owner, { variantId: a.variantId, quantity: "2" }));
    expect((await viewCart(owner, "fa")).ready).toBe(true);
  });

  it("changes only lines of the caller's own cart", async () => {
    const p = await part(5);
    const mine = { guestToken: ok(await addToCart(null, { variantId: p.variantId, quantity: "1" })).newGuestToken! };
    const theirs = { guestToken: ok(await addToCart(null, { variantId: p.variantId, quantity: "1" })).newGuestToken! };
    // Removing the line from one cart leaves the other cart alone; a cart can only change lines it holds.
    ok(await updateCartLine(theirs, { variantId: p.variantId, quantity: "0" }));
    expect((await viewCart(mine, "fa")).lines[0]?.quantity).toBe(1);
    expect(await updateCartLine(theirs, { variantId: p.variantId, quantity: "3" })).toEqual({ status: "invalid", error: "invalid_input" });
    expect(await updateCartLine({ guestToken: "forged" }, { variantId: p.variantId, quantity: "3" })).toEqual({ status: "invalid", error: "invalid_input" });
    expect(await viewCart({ guestToken: "x".repeat(43) }, "fa")).toMatchObject({ lines: [], count: 0 });
  });

  it("moves a guest cart into the customer's cart at sign-in, once", async () => {
    const a = await part(10);
    const b = await part(10);
    const c = await customer();
    ok(await addToCart(c, { variantId: a.variantId, quantity: "1" }));
    const guest = ok(await addToCart(null, { variantId: a.variantId, quantity: "2" })).newGuestToken!;
    ok(await addToCart({ guestToken: guest }, { variantId: b.variantId, quantity: "1" }));

    // Two merges at once (two tabs, or sign-in and a cart action) move the lines once.
    await Promise.all([mergeGuestCart(c.userId, guest), mergeGuestCart(c.userId, guest)]);
    await mergeGuestCart(c.userId, guest);
    const cart = await viewCart(c, "fa");
    expect(cart.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      [a.variantId, 3],
      [b.variantId, 1],
    ]);
    expect((await viewCart({ guestToken: guest }, "fa")).lines).toEqual([]);

    // The retired guest token starts a fresh cart instead of reviving the merged one.
    const again = ok(await addToCart({ guestToken: guest }, { variantId: b.variantId, quantity: "1" }));
    expect(again.newGuestToken).toBeDefined();
    expect(again.newGuestToken).not.toBe(guest);
  });

  it("never builds a cart on a guest token it didn't issue", async () => {
    const p = await part(5);
    const planted = "A".repeat(43);
    const result = ok(await addToCart({ guestToken: planted }, { variantId: p.variantId, quantity: "1" }));
    expect(result.newGuestToken).toBeDefined();
    expect(result.newGuestToken).not.toBe(planted);
    expect((await viewCart({ guestToken: planted }, "fa")).lines).toEqual([]);
    expect((await viewCart({ guestToken: result.newGuestToken! }, "fa")).lines).toHaveLength(1);
  });

  it("clears out guest carts long past their expiry", async () => {
    const p = await part(5);
    const [old] = await q<{ id: string }>(
      "INSERT INTO carts (guest_token_hash, expires_at) VALUES (encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() - interval '61 days') RETURNING id",
    );
    await q("INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, 1)", [old!.id, p.variantId]);
    ok(await addToCart(null, { variantId: p.variantId, quantity: "1" }));
    expect(await q("SELECT 1 FROM carts WHERE id = $1", [old!.id])).toEqual([]);
  });

  it("holds at most the line limit", async () => {
    const c = await customer();
    const parts = await Promise.all(Array.from({ length: MAX_CART_LINES + 1 }, () => part(1)));
    for (const p of parts.slice(0, MAX_CART_LINES)) ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
    expect(await addToCart(c, { variantId: parts[MAX_CART_LINES]!.variantId, quantity: "1" })).toEqual({ status: "invalid", error: "cart_full" });
    expect(await cartCount(c)).toBe(MAX_CART_LINES);
  });
});
