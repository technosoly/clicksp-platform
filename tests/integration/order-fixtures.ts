import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct, setProductStatus } from "@/modules/catalog/service/products";
import { createWarehouse, getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
import { recordMovement } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import { addRate, createMethod, createZone } from "@/modules/shipping/service/shipping-admin";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

/** Catalogue, stock, shipping and customers for order tests (shared by checkout and payments). */

export const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

let shared: { ba: Actor; categoryId: string; locationId: string; methodId: string } | null = null;
export async function setup() {
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

export async function part(stock: number, weightGrams = 600) {
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

export async function customer() {
  const phone = `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const [u] = await q<{ id: string }>("INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [phone]);
  return { userId: u!.id, phone, name: null };
}

export const address = (methodId: string) => ({
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
