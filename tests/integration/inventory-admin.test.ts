import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct } from "@/modules/catalog/service/products";
import { setWarehouseScopes } from "@/modules/identity/service/admin-users";
import { inventoryOverview, productStockForAdmin, recordMovement } from "@/modules/inventory/service/stock";
import { createLocation, createWarehouse, getWarehouseForAdmin, listWarehousesForAdmin, updateLocation, updateWarehouse } from "@/modules/inventory/service/warehouses";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

const warehouseInput = (extra: Record<string, string | boolean> = {}) => ({
  code: `t-${uid()}`,
  name: `TEST انبار ${uid()}`,
  city: "",
  address: "",
  phone: "",
  priority: "",
  isActive: true,
  ...extra,
});

async function warehouse(actor: Actor) {
  const created = ok(await createWarehouse(actor, warehouseInput()));
  const detail = await getWarehouseForAdmin(actor, created.id);
  return { warehouseId: created.id, locationId: detail!.locations[0]!.id };
}

async function product(actor: Actor) {
  const category = ok(await createCategory(actor, { ...testNames("دسته"), parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" }));
  const created = ok(
    await createProduct(actor, {
      faTitle: `TEST قطعه ${uid()}`,
      faSlug: "",
      faShort: "",
      enTitle: "",
      enSlug: "",
      enShort: "",
      brandId: "",
      primaryCategoryId: category.id,
      categoryIds: [],
      warrantyMonths: "",
      sku: `TST-${uid()}`,
      price: "",
      compareAtPrice: "",
    }),
  );
  const [variant] = await q<{ id: string }>("SELECT id FROM product_variants WHERE product_id = $1", [created.id]);
  return { productId: created.id, categoryId: category.id, variantId: variant!.id };
}

const move = (kind: string, variantId: string, locationId: string, quantity: string | number, extra: Record<string, string> = {}) => ({
  kind: kind as "receive",
  variantId,
  locationId,
  quantity: String(quantity),
  reference: "",
  reason: "",
  adjustmentReason: "",
  ...extra,
});

describe("warehouses", () => {
  it("admins create warehouses with a default location; codes are checked and unique", async () => {
    const ba = await actorFor("business_admin");
    const code = `t-${uid()}`;
    const w = ok(await createWarehouse(ba, warehouseInput({ code, phone: "۰۲۱-۱۲۳۴۵۶۷۸" })));
    const detail = await getWarehouseForAdmin(ba, w.id);
    expect(detail).toMatchObject({ code: code.toUpperCase(), phone: "02112345678", priority: 100 });
    expect(detail?.locations.map((l) => [l.code, l.isDefault])).toEqual([["MAIN", true]]);
    expect(await createWarehouse(ba, warehouseInput({ code }))).toEqual({ status: "taken" });
    expect(await createWarehouse(ba, warehouseInput({ code: "bad code" }))).toEqual({ status: "invalid", field: "invalid_code" });
    expect((await listWarehousesForAdmin(ba)).some((x) => x.id === w.id)).toBe(true);

    // A second location becomes the default; the old default can't just be switched off.
    const main = detail!.locations[0]!;
    const shelf = ok(await createLocation(ba, w.id, { code: "a-01.2", description: "", isDefault: true, isActive: true }));
    const after = await getWarehouseForAdmin(ba, w.id);
    expect(after?.locations.map((l) => [l.code, l.isDefault])).toEqual([
      ["A-01.2", true],
      ["MAIN", false],
    ]);
    expect(await updateLocation(ba, w.id, shelf.id, { code: "A-01.2", description: "", isDefault: false, isActive: true })).toEqual({
      status: "invalid",
      field: "default_location_required",
    });
    // A location id of another warehouse is not found through this one.
    const other = await warehouse(ba);
    expect(await updateLocation(ba, other.warehouseId, main.id, { code: "MAIN", description: "", isDefault: false, isActive: false })).toEqual({ status: "not_found" });
    ok(await updateWarehouse(ba, w.id, warehouseInput({ code, name: "TEST renamed", priority: "5" })));
    const [audit] = await q<{ before: { name: string }; after: { name: string } }>("SELECT before, after FROM audit_logs WHERE entity_id = $1 AND action = 'warehouse.updated'", [w.id]);
    expect(audit?.after.name).toBe("TEST renamed");
  });

  it("Store Staff and customers can't manage warehouses", async () => {
    const ba = await actorFor("business_admin");
    const { warehouseId } = await warehouse(ba);
    const staff = await actorFor("store_staff", [], [warehouseId]);
    const customer: Actor = { ...staff, kind: "customer", level: null, permissions: new Map() };
    for (const actor of [staff, customer]) {
      await expect(listWarehousesForAdmin(actor)).rejects.toBeInstanceOf(AuthzError);
      await expect(createWarehouse(actor, warehouseInput())).rejects.toBeInstanceOf(AuthzError);
      await expect(updateWarehouse(actor, warehouseId, warehouseInput())).rejects.toBeInstanceOf(AuthzError);
      await expect(createLocation(actor, warehouseId, { code: "X", description: "", isDefault: false, isActive: true })).rejects.toBeInstanceOf(AuthzError);
    }
  });

  it("admins give Store Staff warehouses; ids are checked", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const staff = await actorFor("store_staff", [], [a.warehouseId]);
    ok(await setWarehouseScopes(ba, staff.userId, [a.warehouseId, b.warehouseId]));
    const rows = await q<{ warehouse_id: string }>(
      "SELECT s.warehouse_id FROM user_role_scopes s JOIN user_roles ur ON ur.id = s.user_role_id WHERE ur.user_id = $1 AND s.scope_type = 'warehouse' ORDER BY s.warehouse_id",
      [staff.userId],
    );
    expect(rows.map((r) => r.warehouse_id).sort()).toEqual([a.warehouseId, b.warehouseId].sort());
    expect(await setWarehouseScopes(ba, staff.userId, ["0193e9c2-7a4b-7c3d-8e9f-0123456789ab"])).toEqual({ status: "invalid", field: "invalid_warehouse" });
    const colleague = await actorFor("store_staff", [], [a.warehouseId]);
    await expect(setWarehouseScopes(colleague, staff.userId, [a.warehouseId])).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("stock movements", () => {
  it("receive, issue and adjust update the balance through the ledger", async () => {
    const ba = await actorFor("business_admin");
    const { warehouseId, locationId } = await warehouse(ba);
    const { productId, variantId } = await product(ba);

    expect(ok(await recordMovement(ba, productId, move("receive", variantId, locationId, "۱۰", { reference: "INV-77" }))).onHandAfter).toBe(10);
    expect(await recordMovement(ba, productId, move("issue", variantId, locationId, 3))).toEqual({ status: "invalid", field: "reason_required" });
    expect(ok(await recordMovement(ba, productId, move("issue", variantId, locationId, 3, { reason: "TEST workshop use" }))).onHandAfter).toBe(7);
    expect(await recordMovement(ba, productId, move("issue", variantId, locationId, 8, { reason: "TEST too many" }))).toEqual({ status: "insufficient_stock" });
    expect(await recordMovement(ba, productId, move("adjust_minus", variantId, locationId, 1))).toEqual({ status: "invalid", field: "adjustment_reason_required" });
    const adjusted = ok(await recordMovement(ba, productId, move("adjust_minus", variantId, locationId, 2, { adjustmentReason: "damage", reason: "TEST broken" })));
    expect(adjusted.onHandAfter).toBe(5);
    expect(await recordMovement(ba, productId, move("receive", variantId, locationId, 0))).toEqual({ status: "invalid", field: "invalid_quantity" });

    const stock = await productStockForAdmin(ba, productId);
    expect(stock?.balances.map((b) => [b.warehouse.id, b.onHand, b.reserved])).toEqual([[warehouseId, 5, 0]]);
    expect(stock?.movements.map((m) => [m.type, m.quantity, m.onHandAfter])).toEqual([
      ["adjustment_minus", 2, 5],
      ["issue", 3, 7],
      ["receipt", 10, 10],
    ]);
    expect(stock?.kinds).toEqual(["receive", "issue", "adjust_plus", "adjust_minus"]);

    const [adjustment] = await q<{ status: string; reason: string; quantity_delta: number }>(
      "SELECT a.status, a.reason, l.quantity_delta FROM stock_adjustment_lines l JOIN stock_adjustments a ON a.id = l.adjustment_id WHERE l.movement_id = $1",
      [adjusted.id],
    );
    expect(adjustment).toEqual({ status: "applied", reason: "damage", quantity_delta: -2 });
    const [receipt] = await q<{ reference_type: string; reference_code: string }>("SELECT reference_type, reference_code FROM inventory_movements WHERE variant_id = $1 AND type = 'receipt'", [variantId]);
    expect(receipt).toEqual({ reference_type: "purchase", reference_code: "INV-77" });
    const audit = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'inventory_movement' AND after->>'variantId' = $1 ORDER BY seq", [variantId]);
    expect(audit.map((a) => a.action)).toEqual(["inventory.receive", "inventory.issue", "inventory.adjust_minus"]);

    const overview = await inventoryOverview(ba, "");
    expect(overview.rows.some((r) => r.variant.product.id === productId && r.onHand === 5)).toBe(true);
  });

  it("two people issuing the last units at once can't take more than there is", async () => {
    const ba = await actorFor("business_admin");
    const { locationId } = await warehouse(ba);
    const { productId, variantId } = await product(ba);
    ok(await recordMovement(ba, productId, move("receive", variantId, locationId, 5)));
    const results = await Promise.all(Array.from({ length: 10 }, () => recordMovement(ba, productId, move("issue", variantId, locationId, 1, { reason: "TEST race" }))));
    expect(results.filter((r) => r.status === "ok")).toHaveLength(5);
    expect(results.filter((r) => r.status === "insufficient_stock")).toHaveLength(5);
    const [balance] = await q<{ on_hand: number }>("SELECT on_hand FROM inventory_balances WHERE variant_id = $1", [variantId]);
    expect(balance?.on_hand).toBe(0);
  });

  it("Store Staff work only in their warehouses and can't adjust", async () => {
    const ba = await actorFor("business_admin");
    const mine = await warehouse(ba);
    const other = await warehouse(ba);
    const { productId, variantId, categoryId } = await product(ba);
    ok(await recordMovement(ba, productId, move("receive", variantId, other.locationId, 4)));
    const staff = await actorFor("store_staff", [categoryId], [mine.warehouseId]);

    ok(await recordMovement(staff, productId, move("receive", variantId, mine.locationId, 6)));
    ok(await recordMovement(staff, productId, move("issue", variantId, mine.locationId, 1, { reason: "TEST" })));
    await expect(recordMovement(staff, productId, move("receive", variantId, other.locationId, 1))).rejects.toBeInstanceOf(AuthzError);
    await expect(recordMovement(staff, productId, move("issue", variantId, other.locationId, 1, { reason: "TEST" }))).rejects.toBeInstanceOf(AuthzError);
    await expect(recordMovement(staff, productId, move("adjust_plus", variantId, mine.locationId, 1, { adjustmentReason: "found" }))).rejects.toBeInstanceOf(AuthzError);

    // They see only their warehouse's stock, and record only there.
    const stock = await productStockForAdmin(staff, productId);
    expect(stock?.balances.map((b) => [b.warehouse.id, b.onHand])).toEqual([[mine.warehouseId, 5]]);
    expect(stock?.movements).toHaveLength(2);
    expect(new Set(stock?.locations.map((l) => l.warehouse.id))).toEqual(new Set([mine.warehouseId]));
    expect(stock?.kinds).toEqual(["receive", "issue"]);
    const overview = await inventoryOverview(staff, "");
    expect(overview.rows.filter((r) => r.variant.product.id === productId).map((r) => r.onHand)).toEqual([5]);

    // Staff without a warehouse see nothing and can record nothing.
    const nowhere = await actorFor("store_staff", [categoryId]);
    const empty = await productStockForAdmin(nowhere, productId);
    expect(empty?.balances).toEqual([]);
    expect(empty?.kinds).toEqual([]);
    await expect(recordMovement(nowhere, productId, move("receive", variantId, mine.locationId, 1))).rejects.toBeInstanceOf(AuthzError);
  });

  it("refuses customers, unknown locations, switched-off warehouses and another product's variant", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const a = await product(ba);
    const b = await product(ba);
    const customer: Actor = { ...ba, kind: "customer", level: null, permissions: new Map() };
    await expect(recordMovement(customer, a.productId, move("receive", a.variantId, w.locationId, 1))).rejects.toBeInstanceOf(AuthzError);
    await expect(inventoryOverview(customer)).rejects.toBeInstanceOf(AuthzError);
    await expect(productStockForAdmin(customer, a.productId)).rejects.toBeInstanceOf(AuthzError);
    const noStock: Actor = { ...ba, permissions: new Map([...ba.permissions].filter(([key]) => !key.startsWith("inventory."))) };
    expect(await productStockForAdmin(noStock, a.productId)).toBeNull();
    await expect(inventoryOverview(noStock)).rejects.toBeInstanceOf(AuthzError);

    expect(await recordMovement(ba, a.productId, move("receive", b.variantId, w.locationId, 1))).toEqual({ status: "not_found" });
    expect(await recordMovement(ba, a.productId, move("receive", a.variantId, "0193e9c2-7a4b-7c3d-8e9f-0123456789ab", 1))).toEqual({ status: "invalid", field: "invalid_location" });
    const detail = await getWarehouseForAdmin(ba, w.warehouseId);
    ok(await updateWarehouse(ba, w.warehouseId, warehouseInput({ code: detail!.code, isActive: false })));
    expect(await recordMovement(ba, a.productId, move("receive", a.variantId, w.locationId, 1))).toEqual({ status: "invalid", field: "invalid_location" });
  });
});

describe("inventory follows category scopes too", () => {
  it("staff can't record or see stock of products outside their categories", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const theirs = await product(ba);
    const foreign = await product(ba);
    ok(await recordMovement(ba, foreign.productId, move("receive", foreign.variantId, w.locationId, 5)));
    ok(await recordMovement(ba, theirs.productId, move("receive", theirs.variantId, w.locationId, 2)));
    const staff = await actorFor("store_staff", [theirs.categoryId], [w.warehouseId]);

    await expect(recordMovement(staff, foreign.productId, move("issue", foreign.variantId, w.locationId, 5, { reason: "TEST" }))).rejects.toBeInstanceOf(AuthzError);
    await expect(productStockForAdmin(staff, foreign.productId)).rejects.toBeInstanceOf(AuthzError);
    const [balance] = await q<{ on_hand: number }>("SELECT on_hand FROM inventory_balances WHERE variant_id = $1", [foreign.variantId]);
    expect(balance?.on_hand).toBe(5);
    const denied = await q("SELECT 1 FROM security_events WHERE user_id = $1 AND type = 'authz.denied' AND details->>'permission' = 'product.view'", [staff.userId]);
    expect(denied.length).toBeGreaterThan(0);

    const ids = (await inventoryOverview(staff, "")).rows.map((r) => r.variant.product.id);
    expect(ids).toContain(theirs.productId);
    expect(ids).not.toContain(foreign.productId);
    // History names people by their name only, never their sign-in username.
    const stock = await productStockForAdmin(staff, theirs.productId);
    expect(Object.keys(stock!.movements[0]!.actor!)).toEqual(["name"]);
  });

  it("issues can't take reserved stock; stocked locations can't be switched off; Super Admins can do everything", async () => {
    const sa = await actorFor("super_admin");
    const w = await warehouse(sa);
    const { productId, variantId } = await product(sa);
    ok(await recordMovement(sa, productId, move("receive", variantId, w.locationId, 3)));
    const [cart] = await q<{ id: string }>("INSERT INTO carts (guest_token_hash) VALUES (encode(sha256(gen_random_uuid()::text::bytea), 'hex')) RETURNING id");
    await q("INSERT INTO stock_reservations (variant_id, location_id, cart_id, quantity, expires_at) VALUES ($1, $2, $3, 2, now() + interval '20 minutes')", [variantId, w.locationId, cart!.id]);
    expect(await recordMovement(sa, productId, move("issue", variantId, w.locationId, 2, { reason: "TEST" }))).toEqual({ status: "insufficient_stock" });
    ok(await recordMovement(sa, productId, move("issue", variantId, w.locationId, 1, { reason: "TEST" })));
    ok(await recordMovement(sa, productId, move("adjust_plus", variantId, w.locationId, 4, { adjustmentReason: "found" })));

    const detail = await getWarehouseForAdmin(sa, w.warehouseId);
    const shelf = ok(await createLocation(sa, w.warehouseId, { code: "B-1", description: "", isDefault: false, isActive: true }));
    // An empty location can be switched off and on again.
    ok(await updateLocation(sa, w.warehouseId, shelf.id, { code: "B-1", description: "", isDefault: false, isActive: false }));
    ok(await updateLocation(sa, w.warehouseId, shelf.id, { code: "B-1", description: "", isDefault: false, isActive: true }));
    ok(await recordMovement(sa, productId, move("receive", variantId, shelf.id, 1)));
    expect(await updateLocation(sa, w.warehouseId, shelf.id, { code: "B-1", description: "", isDefault: false, isActive: false })).toEqual({ status: "invalid", field: "holds_stock" });
    expect(await updateWarehouse(sa, w.warehouseId, warehouseInput({ code: detail!.code, isActive: false }))).toEqual({ status: "invalid", field: "holds_stock" });
  });

  it("Store Staff can't open a warehouse or edit its locations", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const staff = await actorFor("store_staff", [], [w.warehouseId]);
    await expect(getWarehouseForAdmin(staff, w.warehouseId)).rejects.toBeInstanceOf(AuthzError);
    await expect(updateLocation(staff, w.warehouseId, w.locationId, { code: "MAIN", description: "", isDefault: true, isActive: true })).rejects.toBeInstanceOf(AuthzError);
    // A Business Admin can't scope another Business Admin's account.
    const otherBa = await actorFor("business_admin");
    await expect(setWarehouseScopes(ba, otherBa.userId, [w.warehouseId])).rejects.toBeInstanceOf(AuthzError);
    // Clearing a staff member's warehouses leaves them with none.
    ok(await setWarehouseScopes(ba, staff.userId, []));
    const rows = await q("SELECT 1 FROM user_role_scopes s JOIN user_roles ur ON ur.id = s.user_role_id WHERE ur.user_id = $1 AND s.scope_type = 'warehouse'", [staff.userId]);
    expect(rows).toHaveLength(0);
  });
});
