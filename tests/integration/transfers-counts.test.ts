/**
 * Stock transfers between warehouses and stock counts through the real
 * services on PostgreSQL. Data is synthetic (TEST ...).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct } from "@/modules/catalog/service/products";
import { addProductToCount, cancelCount, completeCount, enterCounts, getCountForAdmin, listCountsForAdmin, startCount } from "@/modules/inventory/service/counts";
import { recordMovement } from "@/modules/inventory/service/stock";
import { advanceTransfer, createTransfer, getTransferForAdmin, listTransfersForAdmin, removeTransferLine, setTransferLine } from "@/modules/inventory/service/transfers";
import { createLocation, createWarehouse, getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
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

async function warehouse(actor: Actor) {
  const created = ok(await createWarehouse(actor, { code: `t-${uid()}`, name: `TEST انبار ${uid()}`, city: "", address: "", phone: "", priority: "", isActive: true }));
  const detail = await getWarehouseForAdmin(actor, created.id);
  return { warehouseId: created.id, locationId: detail!.locations[0]!.id };
}

async function product(actor: Actor) {
  const category = ok(await createCategory(actor, { ...testNames("دسته"), parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" }));
  const sku = `TST-${uid()}`;
  const created = ok(
    await createProduct(actor, { faTitle: `TEST قطعه ${uid()}`, faSlug: "", faShort: "", enTitle: "", enSlug: "", enShort: "", brandId: "", primaryCategoryId: category.id, categoryIds: [], warrantyMonths: "", sku, price: "", compareAtPrice: "" }),
  );
  const [variant] = await q<{ id: string }>("SELECT id FROM product_variants WHERE product_id = $1", [created.id]);
  return { productId: created.id, categoryId: category.id, variantId: variant!.id, sku };
}

const receive = (actor: Actor, p: { productId: string; variantId: string }, locationId: string, quantity: number) =>
  recordMovement(actor, p.productId, { kind: "receive", variantId: p.variantId, locationId, quantity: String(quantity), reference: "", reason: "", adjustmentReason: "" });

const onHand = async (variantId: string, locationId: string) =>
  (await q<{ on_hand: number }>("SELECT on_hand FROM inventory_balances WHERE variant_id = $1 AND location_id = $2", [variantId, locationId]))[0]?.on_hand ?? 0;

describe("stock transfers", () => {
  it("ships out of the source, receives into the destination, once", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, a.locationId, 10));

    const t = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "TEST" }));
    expect(await advanceTransfer(ba, t.id, "ship")).toEqual({ status: "invalid", field: "no_lines" });
    ok(await setTransferLine(ba, t.id, { sku: p.sku.toLowerCase(), quantity: "۴", fromLocationId: a.locationId, toLocationId: b.locationId }));
    ok(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "6", fromLocationId: a.locationId, toLocationId: b.locationId }));
    expect(await setTransferLine(ba, t.id, { sku: "NOPE-0", quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId })).toEqual({ status: "invalid", field: "unknown_sku" });
    expect(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "1", fromLocationId: b.locationId, toLocationId: a.locationId })).toEqual({ status: "invalid", field: "invalid_location" });
    const detail = await getTransferForAdmin(ba, t.id);
    expect(detail?.transfer.lines.map((l) => l.quantity)).toEqual([6]);
    expect(detail?.can).toEqual({ edit: true, ship: true, receive: false, cancel: true });

    // Two presses at once ship it once.
    const results = await Promise.all([advanceTransfer(ba, t.id, "ship"), advanceTransfer(ba, t.id, "ship")]);
    expect(results.map((r) => r.status).sort()).toEqual(["ok", "wrong_status"]);
    expect(await onHand(p.variantId, a.locationId)).toBe(4);
    expect(await onHand(p.variantId, b.locationId)).toBe(0);
    expect(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId })).toEqual({ status: "wrong_status" });

    ok(await advanceTransfer(ba, t.id, "receive"));
    expect(await advanceTransfer(ba, t.id, "receive")).toEqual({ status: "wrong_status" });
    expect(await onHand(p.variantId, b.locationId)).toBe(6);
    const moves = await q<{ type: string; quantity: number }>("SELECT type::text, quantity FROM inventory_movements WHERE transfer_id = $1 ORDER BY created_at", [t.id]);
    expect(moves).toEqual([
      { type: "transfer_out", quantity: 6 },
      { type: "transfer_in", quantity: 6 },
    ]);
    const audits = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq", [t.id]);
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["inventory.transfer_created", "inventory.transfer_shipped", "inventory.transfer_received"]));
  });

  it("refuses to ship more than is free, and a cancelled shipment goes back to the source", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, a.locationId, 3));
    const t = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    ok(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "5", fromLocationId: a.locationId, toLocationId: b.locationId }));
    expect(await advanceTransfer(ba, t.id, "ship")).toEqual({ status: "insufficient_stock", sku: p.sku });
    expect(await onHand(p.variantId, a.locationId)).toBe(3);
    ok(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "2", fromLocationId: a.locationId, toLocationId: b.locationId }));
    ok(await advanceTransfer(ba, t.id, "ship"));
    expect(await onHand(p.variantId, a.locationId)).toBe(1);
    ok(await advanceTransfer(ba, t.id, "cancel"));
    expect(await onHand(p.variantId, a.locationId)).toBe(3);
    expect(await onHand(p.variantId, b.locationId)).toBe(0);
    expect(await advanceTransfer(ba, t.id, "receive")).toEqual({ status: "wrong_status" });

    const draft = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    const line = ok(await setTransferLine(ba, draft.id, { sku: p.sku, quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId }));
    const [row] = await q<{ id: string }>("SELECT id FROM stock_transfer_lines WHERE transfer_id = $1", [line.id]);
    ok(await removeTransferLine(ba, draft.id, row!.id));
    ok(await advanceTransfer(ba, draft.id, "cancel"));
    expect(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: a.warehouseId, note: "" })).toEqual({ status: "invalid", field: "same_warehouse" });
  });

  it("Store Staff transfer only between their warehouses; the destination receives", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const c = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, a.locationId, 5));
    const staffA = await actorFor("store_staff", [p.categoryId], [a.warehouseId]);
    const staffAB = await actorFor("store_staff", [p.categoryId], [a.warehouseId, b.warehouseId]);
    const staffB = await actorFor("store_staff", [p.categoryId], [b.warehouseId]);
    await expect(createTransfer(staffA, { fromWarehouseId: a.warehouseId, toWarehouseId: c.warehouseId, note: "" })).rejects.toBeInstanceOf(AuthzError);
    const t = ok(await createTransfer(staffAB, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    ok(await setTransferLine(staffAB, t.id, { sku: p.sku, quantity: "2", fromLocationId: a.locationId, toLocationId: b.locationId }));
    // A staff member of the source only ships; one of the destination only receives.
    expect((await getTransferForAdmin(staffA, t.id))?.can).toEqual({ edit: false, ship: true, receive: false, cancel: true });
    await expect(advanceTransfer(staffB, t.id, "ship")).rejects.toBeInstanceOf(AuthzError);
    ok(await advanceTransfer(staffA, t.id, "ship"));
    await expect(advanceTransfer(staffA, t.id, "receive")).rejects.toBeInstanceOf(AuthzError);
    ok(await advanceTransfer(staffB, t.id, "receive"));
    const staffC = await actorFor("store_staff", [p.categoryId], [c.warehouseId]);
    expect(await getTransferForAdmin(staffC, t.id)).toBeNull();
    expect((await listTransfersForAdmin(staffC)).some((x) => x.id === t.id)).toBe(false);
    // Products outside the staff member's categories can't be added.
    const other = await product(ba);
    const t2 = ok(await createTransfer(staffAB, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    await expect(setTransferLine(staffAB, t2.id, { sku: other.sku, quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId })).rejects.toBeInstanceOf(AuthzError);
    const customer = { ...ba, kind: "customer" as const };
    await expect(listTransfersForAdmin(customer)).rejects.toBeInstanceOf(AuthzError);
  });

  it("keeps a transfer whole: scoped staff can't act on lines outside their categories, or on another transfer's lines", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const mine = await product(ba);
    const theirs = await product(ba);
    ok(await receive(ba, mine, a.locationId, 5));
    ok(await receive(ba, theirs, a.locationId, 5));
    const t = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    ok(await setTransferLine(ba, t.id, { sku: mine.sku, quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId }));
    ok(await setTransferLine(ba, t.id, { sku: theirs.sku, quantity: "1", fromLocationId: a.locationId, toLocationId: b.locationId }));
    const [hidden] = await q<{ id: string }>("SELECT id FROM stock_transfer_lines WHERE transfer_id = $1 AND variant_id = $2", [t.id, theirs.variantId]);

    const staff = await actorFor("store_staff", [mine.categoryId], [a.warehouseId, b.warehouseId]);
    const view = await getTransferForAdmin(staff, t.id);
    expect(view?.transfer.lines.map((l) => l.variant.id)).toEqual([mine.variantId]);
    expect(view?.hiddenLines).toBe(1);
    expect(view?.can).toEqual({ edit: false, ship: false, receive: false, cancel: false });
    await expect(advanceTransfer(staff, t.id, "ship")).rejects.toBeInstanceOf(AuthzError);
    await expect(advanceTransfer(staff, t.id, "cancel")).rejects.toBeInstanceOf(AuthzError);
    await expect(removeTransferLine(staff, t.id, hidden!.id)).rejects.toBeInstanceOf(AuthzError);
    expect(await onHand(theirs.variantId, a.locationId)).toBe(5);

    // A line id of another transfer is not found, and nothing is removed.
    const other = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    expect(await removeTransferLine(ba, other.id, hidden!.id)).toEqual({ status: "not_found" });
    expect(await q("SELECT 1 FROM stock_transfer_lines WHERE id = $1", [hidden!.id])).toHaveLength(1);

    // Quantities are plain whole numbers.
    for (const quantity of ["1e2", "0x10", "2.5", "0", ""]) {
      expect(await setTransferLine(ba, t.id, { sku: mine.sku, quantity, fromLocationId: a.locationId, toLocationId: b.locationId })).toEqual({ status: "invalid", field: "invalid_quantity" });
    }

    // Removing a line is audited with what it held.
    ok(await removeTransferLine(ba, t.id, hidden!.id));
    const [audit] = await q<{ before: { sku: string; quantity: number } }>("SELECT before FROM audit_logs WHERE entity_id = $1 AND action = 'inventory.transfer_line_removed'", [t.id]);
    expect(audit?.before).toMatchObject({ sku: theirs.sku, quantity: 1 });
  });

  it("only someone at both ends cancels a transfer on the road", async () => {
    const ba = await actorFor("business_admin");
    const a = await warehouse(ba);
    const b = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, a.locationId, 3));
    const staffA = await actorFor("store_staff", [p.categoryId], [a.warehouseId]);
    const t = ok(await createTransfer(ba, { fromWarehouseId: a.warehouseId, toWarehouseId: b.warehouseId, note: "" }));
    ok(await setTransferLine(ba, t.id, { sku: p.sku, quantity: "2", fromLocationId: a.locationId, toLocationId: b.locationId }));
    ok(await advanceTransfer(staffA, t.id, "ship"));
    expect((await getTransferForAdmin(staffA, t.id))?.can.cancel).toBe(false);
    await expect(advanceTransfer(staffA, t.id, "cancel")).rejects.toBeInstanceOf(AuthzError);
    expect(await onHand(p.variantId, a.locationId)).toBe(1);
    ok(await advanceTransfer(ba, t.id, "cancel"));
    expect(await onHand(p.variantId, a.locationId)).toBe(3);
  });
});

describe("stock counts", () => {
  it("lists stock, takes counts, and applies the differences when an admin completes it", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const shelf = ok(await createLocation(ba, w.warehouseId, { code: `S${uid()}`, description: "", isDefault: false, isActive: true }));
    const p1 = await product(ba);
    const p2 = await product(ba);
    const p3 = await product(ba);
    ok(await receive(ba, p1, w.locationId, 10));
    ok(await receive(ba, p2, w.locationId, 4));
    const c = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "TEST" }));
    expect(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "" })).toEqual({ status: "count_open" });
    const view = await getCountForAdmin(ba, c.id);
    expect(view?.total).toBe(2);
    const line = (variantId: string) => view!.lines.find((l) => l.variant.id === variantId)!;
    expect(line(p1.variantId).expectedQty).toBe(10);

    // A sale of 2 before p1 is counted: the count of 7 means 1 lost, not 3.
    ok(await recordMovement(ba, p1.productId, { kind: "issue", variantId: p1.variantId, locationId: w.locationId, quantity: "2", reference: "", reason: "TEST sold", adjustmentReason: "" }));
    ok(await enterCounts(ba, c.id, [
      { lineId: line(p1.variantId).id, quantity: "۷" },
      { lineId: line(p2.variantId).id, quantity: "4" },
    ]));
    // Found on another shelf, not in the list.
    ok(await addProductToCount(ba, c.id, { sku: p3.sku, locationId: shelf.id }));
    expect(await addProductToCount(ba, c.id, { sku: p3.sku, locationId: shelf.id })).toEqual({ status: "invalid", field: "already_listed" });
    const again = await getCountForAdmin(ba, c.id, 1, true);
    expect(again?.lines.map((l) => l.variant.id)).toEqual([p3.variantId]);
    ok(await enterCounts(ba, c.id, [{ lineId: again!.lines[0]!.id, quantity: "3" }]));
    expect(await enterCounts(ba, c.id, [{ lineId: again!.lines[0]!.id, quantity: "-1" }])).toEqual({ status: "invalid", field: "invalid_quantity" });

    const staff = await actorFor("store_staff", [p1.categoryId], [w.warehouseId]);
    await expect(completeCount(staff, c.id)).rejects.toBeInstanceOf(AuthzError);
    expect((await getCountForAdmin(staff, c.id))?.can.complete).toBe(false);
    // Staff see only products of their categories.
    expect((await getCountForAdmin(staff, c.id))?.lines.map((l) => l.variant.id)).toEqual([p1.variantId]);

    expect(await completeCount(ba, c.id)).toEqual({ status: "ok", id: c.id, changed: 2 });
    expect(await onHand(p1.variantId, w.locationId)).toBe(7);
    expect(await onHand(p2.variantId, w.locationId)).toBe(4);
    expect(await onHand(p3.variantId, shelf.id)).toBe(3);
    const moves = await q<{ type: string; quantity: number }>("SELECT type::text, quantity FROM inventory_movements WHERE reference_type = 'count' AND reference_id = $1 ORDER BY type", [c.id]);
    expect(moves).toEqual([
      { type: "count_gain", quantity: 3 },
      { type: "count_loss", quantity: 1 },
    ]);
    expect(await completeCount(ba, c.id)).toEqual({ status: "wrong_status" });
    expect(await enterCounts(ba, c.id, [{ lineId: line(p1.variantId).id, quantity: "1" }])).toEqual({ status: "wrong_status" });
    // A new count can start once the last one is closed.
    const next = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: shelf.id, note: "" }));
    expect((await getCountForAdmin(ba, next.id))?.total).toBe(1);
    ok(await cancelCount(ba, next.id));
  });

  it("saving a page again keeps the difference found earlier", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, w.locationId, 10));
    const c = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "" }));
    const lineId = (await getCountForAdmin(ba, c.id))!.lines[0]!.id;
    // 8 on the shelf where the system shows 10: 2 missing.
    expect(await enterCounts(ba, c.id, [{ lineId, quantity: "8" }])).toEqual({ status: "ok", id: c.id, changed: 1 });
    // A sale of 2 afterwards, then the same page is saved again unchanged.
    ok(await recordMovement(ba, p.productId, { kind: "issue", variantId: p.variantId, locationId: w.locationId, quantity: "2", reference: "", reason: "TEST sold", adjustmentReason: "" }));
    expect(await enterCounts(ba, c.id, [{ lineId, quantity: "8" }])).toEqual({ status: "ok", id: c.id, changed: 0 });
    expect((await getCountForAdmin(ba, c.id))!.lines[0]!.expectedQty).toBe(10);
    ok(await completeCount(ba, c.id));
    expect(await onHand(p.variantId, w.locationId)).toBe(6);
    const audits = await q<{ after: { lines: unknown[] } }>("SELECT after FROM audit_logs WHERE entity_id = $1 AND action = 'inventory.count_entered'", [c.id]);
    expect(audits).toHaveLength(1);
  });

  it("enters counts only on the count's own lines in the actor's categories; counting is blind", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const w2 = await warehouse(ba);
    const mine = await product(ba);
    const theirs = await product(ba);
    ok(await receive(ba, mine, w.locationId, 5));
    ok(await receive(ba, theirs, w.locationId, 5));
    ok(await receive(ba, mine, w2.locationId, 5));
    const c = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "" }));
    const c2 = ok(await startCount(ba, { warehouseId: w2.warehouseId, locationId: "", note: "" }));
    const lines = (await getCountForAdmin(ba, c.id))!.lines;
    const theirLine = lines.find((l) => l.variant.id === theirs.variantId)!;
    const otherCountLine = (await getCountForAdmin(ba, c2.id))!.lines[0]!;

    const staff = await actorFor("store_staff", [mine.categoryId], [w.warehouseId, w2.warehouseId]);
    const view = await getCountForAdmin(staff, c.id);
    expect(view?.lines.map((l) => l.expectedQty)).toEqual([null]);
    expect(view?.showExpected).toBe(false);
    expect(view?.counted).toBe(0);
    // Out of category, and a line of another count: nothing is saved.
    expect(await enterCounts(staff, c.id, [{ lineId: theirLine.id, quantity: "1" }])).toEqual({ status: "ok", id: c.id, changed: 0 });
    expect(await enterCounts(ba, c.id, [{ lineId: otherCountLine.id, quantity: "1" }])).toEqual({ status: "ok", id: c.id, changed: 0 });
    const untouched = await q<{ counted_qty: number | null }>("SELECT counted_qty FROM inventory_count_lines WHERE id = ANY($1::uuid[])", [[theirLine.id, otherCountLine.id]]);
    expect(untouched.map((r) => r.counted_qty)).toEqual([null, null]);
    expect(await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'inventory.count_entered'", [c.id])).toHaveLength(0);

    // Their count of the other product isn't in the staff member's progress figure.
    ok(await enterCounts(ba, c.id, [{ lineId: theirLine.id, quantity: "5" }]));
    expect((await getCountForAdmin(staff, c.id))?.counted).toBe(0);
    // Only whoever started the count (or an admin) cancels it.
    expect((await getCountForAdmin(staff, c.id))?.can.cancel).toBe(false);
    await expect(cancelCount(staff, c.id)).rejects.toBeInstanceOf(AuthzError);
    // Odd page numbers don't break the page.
    expect((await getCountForAdmin(ba, c.id, 1.5))?.page).toBe(1);
    ok(await cancelCount(ba, c.id));
    ok(await cancelCount(ba, c2.id));
  });

  it("a count typed while it is being completed is either applied or refused, never lost", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, w.locationId, 10));
    const c = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "" }));
    const lineId = (await getCountForAdmin(ba, c.id))!.lines[0]!.id;
    const [entered, completed] = await Promise.all([enterCounts(ba, c.id, [{ lineId, quantity: "7" }]), completeCount(ba, c.id)]);
    ok(completed);
    if (entered.status === "ok") {
      // Saved before completion took the lock, so completion applied it.
      expect(await onHand(p.variantId, w.locationId)).toBe(7);
    } else {
      expect(entered).toEqual({ status: "wrong_status" });
      expect(await onHand(p.variantId, w.locationId)).toBe(10);
    }
  });

  it("Store Staff count only in their warehouses; customers are refused", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const other = await warehouse(ba);
    const staff = await actorFor("store_staff", [], [w.warehouseId]);
    const c = ok(await startCount(staff, { warehouseId: w.warehouseId, locationId: "", note: "" }));
    await expect(startCount(staff, { warehouseId: other.warehouseId, locationId: "", note: "" })).rejects.toBeInstanceOf(AuthzError);
    const elsewhere = ok(await startCount(ba, { warehouseId: other.warehouseId, locationId: "", note: "" }));
    await expect(getCountForAdmin(staff, elsewhere.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(cancelCount(staff, elsewhere.id)).rejects.toBeInstanceOf(AuthzError);
    expect((await listCountsForAdmin(staff)).counts.map((x) => x.id)).toContain(c.id);
    expect((await listCountsForAdmin(staff)).counts.map((x) => x.id)).not.toContain(elsewhere.id);
    ok(await cancelCount(staff, c.id));
    const customer = { ...ba, kind: "customer" as const };
    await expect(startCount(customer, { warehouseId: w.warehouseId, locationId: "", note: "" })).rejects.toBeInstanceOf(AuthzError);
  });

  it("refuses a loss that would go below what open orders hold", async () => {
    const ba = await actorFor("business_admin");
    const w = await warehouse(ba);
    const p = await product(ba);
    ok(await receive(ba, p, w.locationId, 5));
    const [cart] = await q<{ id: string }>("INSERT INTO carts (guest_token_hash) VALUES (repeat('a', 64)) RETURNING id");
    await q("INSERT INTO stock_reservations (variant_id, location_id, quantity, cart_id, expires_at) VALUES ($1, $2, 4, $3, now() + interval '1 hour')", [p.variantId, w.locationId, cart!.id]);
    const c = ok(await startCount(ba, { warehouseId: w.warehouseId, locationId: "", note: "" }));
    const view = await getCountForAdmin(ba, c.id);
    ok(await enterCounts(ba, c.id, [{ lineId: view!.lines[0]!.id, quantity: "0" }]));
    expect(await completeCount(ba, c.id)).toEqual({ status: "insufficient_stock", sku: p.sku });
    expect(await onHand(p.variantId, w.locationId)).toBe(5);
    // Counted at 4: a loss of 1 still covers the 4 held, so it applies.
    ok(await enterCounts(ba, c.id, [{ lineId: view!.lines[0]!.id, quantity: "4" }]));
    ok(await completeCount(ba, c.id));
    expect(await onHand(p.variantId, w.locationId)).toBe(4);
  });
});
