/**
 * Phase 6 catalog admin through the real services on PostgreSQL:
 * categories, brands, products, variants, prices (direct and through
 * approval), part numbers, publishing, and Store Staff category scopes
 * (which cover everything below a scoped category). Every admin level is
 * checked for what it may and may not do. Data is synthetic (TEST ...).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db as prisma, transaction } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import sharp from "sharp";
import { setVariantPriceIfUnchanged } from "@/modules/catalog/repo/catalog-repo";
import {
  addProductImage,
  listProductImagesForAdmin,
  makePrimaryProductImage,
  removeProductImage,
  reorderProductImage,
  updateProductImage,
} from "@/modules/catalog/service/product-images";
import { imageRenditions, openPublicImage } from "@/modules/media/service/images";
import { setBrandLogo, setCategoryImage } from "@/modules/catalog/service/catalog-pictures";
import { createBrand, updateBrand } from "@/modules/catalog/service/brands";
import { createCategory, listCategoriesForAdmin, updateCategory } from "@/modules/catalog/service/categories";
import { cancelOwnPriceRequest, decidePriceRequest, listApprovalInbox, listOwnApprovalRequests } from "@/modules/catalog/service/price-approvals";
import {
  addIdentifier,
  addVariant,
  changeCost,
  changePrice,
  createProduct,
  getProductForAdmin,
  listProductsForAdmin,
  removeIdentifier,
  setProductStatus,
  updateProduct,
  updateVariant,
} from "@/modules/catalog/service/products";
import { setCategoryScopes } from "@/modules/identity/service/admin-users";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError, loadEffectivePermissions } from "@/modules/rbac/service/authorize";
import { one, pool, uid } from "./helpers";

type Level = "super_admin" | "business_admin" | "store_staff";
const LEVEL: Record<Level, number> = { super_admin: 1, business_admin: 2, store_staff: 3 };
let ip = 0;
const meta = (): RequestMeta => {
  ip += 1;
  return { ipAddress: `198.51.100.${(ip % 250) + 1}`, userAgent: "vitest", requestId: null };
};

async function q<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

/** An admin of the given level; Store Staff optionally scoped to categories. */
async function actorFor(level: Level, scopeCategoryIds: string[] = []): Promise<Actor & { userId: string }> {
  const client = await pool.connect();
  try {
    const user = await one<{ id: string }>(client, "INSERT INTO users (username, name) VALUES ($1, 'TEST CATALOG') RETURNING id", [
      `test-cat-${uid().toLowerCase()}`,
    ]);
    const ur = await one<{ id: string }>(
      client,
      `INSERT INTO user_roles (user_id, role_id, expires_at)
       SELECT $1, id, CASE WHEN level = 1 THEN now() + interval '1 day' END FROM roles WHERE key = $2 RETURNING id`,
      [user.id, level],
    );
    for (const categoryId of scopeCategoryIds) {
      await client.query("INSERT INTO user_role_scopes (user_role_id, scope_type, category_id) VALUES ($1, 'category', $2)", [ur.id, categoryId]);
    }
    return {
      kind: "admin",
      userId: user.id,
      sessionId: null,
      level: LEVEL[level],
      permissions: await loadEffectivePermissions(user.id),
      mfaVerifiedAt: new Date(),
      meta: meta(),
    };
  } finally {
    client.release();
  }
}

const names = (label: string) => ({ faName: `TEST ${label} ${uid()}`, faSlug: "", enName: "", enSlug: "" });

async function newCategory(actor: Actor, parentId: string | null = null): Promise<string> {
  const result = await createCategory(actor, { ...names("دسته"), parentId: parentId ?? "", isVehicleSystem: false, isActive: true, sortOrder: "0" });
  if (result.status !== "ok") throw new Error(`category: ${JSON.stringify(result)}`);
  return result.id;
}

const productInput = (categoryId: string, extra: Partial<Record<string, unknown>> = {}) => ({
  faTitle: `TEST لنت ترمز ${uid()}`,
  faSlug: "",
  faShort: "",
  enTitle: "",
  enSlug: "",
  enShort: "",
  brandId: "",
  primaryCategoryId: categoryId,
  categoryIds: [] as string[],
  warrantyMonths: "",
  sku: `TST-${uid()}`,
  price: "",
  compareAtPrice: "",
  ...extra,
});

async function newProduct(actor: Actor, categoryId: string, price = ""): Promise<{ productId: string; variantId: string }> {
  const result = await createProduct(actor, productInput(categoryId, { price }));
  if (result.status !== "ok") throw new Error(`product: ${JSON.stringify(result)}`);
  const [variant] = await q<{ id: string }>("SELECT id FROM product_variants WHERE product_id = $1 AND is_default", [result.id]);
  return { productId: result.id, variantId: variant!.id };
}

const priceOf = async (variantId: string) => (await q<{ price: string }>("SELECT price::text FROM product_variants WHERE id = $1", [variantId]))[0]!.price;

afterAll(async () => {
  await prisma().$disconnect();
});

describe("categories", () => {
  it("Business Admins build the tree; scoped Store Staff work only below their categories", async () => {
    const ba = await actorFor("business_admin");
    const root = await newCategory(ba);
    const child = await newCategory(ba, root);
    const other = await newCategory(ba);

    const staff = await actorFor("store_staff", [root]);
    // The scope covers everything below the scoped category.
    const grandchild = await newCategory(staff, child);
    // Permissions are loaded per request; the next request sees the new category in scope.
    staff.permissions = await loadEffectivePermissions(staff.userId);
    expect(
      await updateCategory(staff, grandchild, { ...names("ویرایش"), parentId: child, isVehicleSystem: false, isActive: true, sortOrder: "2" }),
    ).toMatchObject({ status: "ok" });
    // No top-level categories, nothing outside the scope, no moving out of it.
    await expect(newCategory(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(newCategory(staff, other)).rejects.toBeInstanceOf(AuthzError);
    await expect(
      updateCategory(staff, grandchild, { ...names("x"), parentId: other, isVehicleSystem: false, isActive: true, sortOrder: "0" }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(updateCategory(staff, other, { ...names("x"), parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" })).rejects.toBeInstanceOf(AuthzError);
    // Moving changes who else can see a subtree, so even a move inside the scope needs unscoped access.
    await expect(
      updateCategory(staff, grandchild, { ...names("x"), parentId: root, isVehicleSystem: false, isActive: true, sortOrder: "0" }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(await updateCategory(ba, grandchild, { ...names("x"), parentId: root, isVehicleSystem: false, isActive: true, sortOrder: "0" })).toMatchObject({ status: "ok" });

    const list = await listCategoriesForAdmin(staff);
    expect(list.canCreateRoot).toBe(false);
    expect(list.rows.map((r) => r.id)).toEqual(expect.arrayContaining([root, child, grandchild]));
    expect(list.rows.map((r) => r.id)).not.toContain(other);

    // Staff without any scope: the scoped permission allows nothing.
    const unscoped = await actorFor("store_staff");
    await expect(newCategory(unscoped, root)).rejects.toBeInstanceOf(AuthzError);
    expect((await listCategoriesForAdmin(unscoped)).rows).toEqual([]);

    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq", [grandchild])).map((a) => a.action);
    expect(actions).toEqual(["category.created", "category.updated", "category.updated"]);
  });

  it("refuses cycles, duplicate slugs and a missing Persian name", async () => {
    const sa = await actorFor("super_admin");
    const root = await newCategory(sa);
    const child = await newCategory(sa, root);
    expect(await updateCategory(sa, root, { ...names("r"), parentId: child, isVehicleSystem: false, isActive: true, sortOrder: "0" })).toEqual({
      status: "invalid",
      field: "invalid_parent",
    });
    const slug = `test-slug-${uid().toLowerCase()}`;
    expect(await createCategory(sa, { faName: "TEST a", faSlug: slug, enName: "", enSlug: "", parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "" })).toMatchObject({ status: "ok" });
    expect(await createCategory(sa, { faName: "TEST b", faSlug: slug, enName: "", enSlug: "", parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "" })).toEqual({ status: "taken" });
    expect(await createCategory(sa, { faName: "  ", faSlug: "", enName: "Brakes", enSlug: "", parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "" })).toEqual({
      status: "invalid",
      field: "fa_name_required",
    });
    // Persian slug from the name, half-space and digits normalized.
    const made = await createCategory(sa, { faName: `TEST لنت‌ترمز ۱۲ ${uid()}`, faSlug: "", enName: "", enSlug: "", parentId: "", isVehicleSystem: true, isActive: true, sortOrder: "۳" });
    if (made.status !== "ok") throw new Error(made.status);
    const [row] = await q<{ slug: string; sort_order: number }>(
      "SELECT t.slug, c.sort_order FROM category_translations t JOIN categories c ON c.id = t.category_id WHERE t.category_id = $1",
      [made.id],
    );
    expect(row!.slug).toMatch(/^test-لنت-ترمز-12-[a-z0-9]+$/);
    expect(row!.sort_order).toBe(3);
  });
});

describe("brands", () => {
  it("every admin level may manage brands; a customer-like actor may not", async () => {
    const staff = await actorFor("store_staff");
    const created = await createBrand(staff, { ...names("برند"), isGenuine: true, isActive: true, sortOrder: "" });
    if (created.status !== "ok") throw new Error(created.status);
    expect(await updateBrand(staff, created.id, { faName: "TEST برند ویرایش", faSlug: "", enName: "TEST Brand", enSlug: "", isGenuine: false, isActive: false, sortOrder: "1" })).toMatchObject({
      status: "ok",
    });
    const customer: Actor = { ...staff, kind: "customer", level: null, permissions: new Map() };
    await expect(createBrand(customer, { ...names("x"), isGenuine: false, isActive: true, sortOrder: "" })).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("products and prices", () => {
  it("a Business Admin creates, prices and publishes; the price history records who", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const created = await createProduct(ba, productInput(category, { price: "۱۲۵٬۰۰۰", compareAtPrice: "150000" }));
    if (created.status !== "ok") throw new Error(JSON.stringify(created));
    expect(created.priceStatus).toBe("applied");
    const [variant] = await q<{ id: string; price: string; compare_at_price: string }>(
      "SELECT id, price::text, compare_at_price::text FROM product_variants WHERE product_id = $1",
      [created.id],
    );
    // Toman typed with Persian digits, stored as integer Rial.
    expect(variant).toMatchObject({ price: "1250000", compare_at_price: "1500000" });
    expect(await setProductStatus(ba, created.id, "active")).toEqual({ status: "ok", id: created.id });

    expect(await changePrice(ba, variant!.id, { price: "130000", compareAtPrice: "" })).toEqual({ status: "applied" });
    const history = await q<{ price: string; changed_by: string; approval_id: string | null }>(
      "SELECT price::text, changed_by, approval_id FROM product_prices WHERE variant_id = $1 ORDER BY price",
      [variant!.id],
    );
    expect(history).toEqual([
      { price: "1250000", changed_by: ba.userId, approval_id: null },
      { price: "1300000", changed_by: ba.userId, approval_id: null },
    ]);
    expect(await changePrice(ba, variant!.id, { price: "130000", compareAtPrice: "" })).toEqual({ status: "unchanged" });
    expect(await changePrice(ba, variant!.id, { price: "0", compareAtPrice: "" })).toEqual({ status: "invalid", field: "invalid_price" });
    expect(await changePrice(ba, variant!.id, { price: "100", compareAtPrice: "90" })).toEqual({ status: "invalid", field: "invalid_compare_at" });

    const detail = await getProductForAdmin(ba, created.id);
    expect(detail?.can).toMatchObject({ edit: true, setPrice: true, proposePrice: false, archive: true });
    expect(await setProductStatus(ba, created.id, "archived")).toMatchObject({ status: "ok" });
  });

  it("an unpriced product can't be published", async () => {
    const ba = await actorFor("business_admin");
    const { productId } = await newProduct(ba, await newCategory(ba));
    expect(await setProductStatus(ba, productId, "active")).toEqual({ status: "not_publishable", problems: ["no_price"] });
  });

  it("Store Staff work only on products of their categories and only propose prices", async () => {
    const ba = await actorFor("business_admin");
    const mine = await newCategory(ba);
    const sub = await newCategory(ba, mine);
    const notMine = await newCategory(ba);
    const staff = await actorFor("store_staff", [mine]);

    // Creating with a price: the product starts unpriced and the price waits for approval.
    const created = await createProduct(staff, productInput(sub, { price: "200000" }));
    if (created.status !== "ok") throw new Error(JSON.stringify(created));
    expect(created.priceStatus).toBe("proposed");
    const [variant] = await q<{ id: string; price: string }>("SELECT id, price::text FROM product_variants WHERE product_id = $1", [created.id]);
    expect(variant!.price).toBe("0");
    expect((await listOwnApprovalRequests(staff)).map((r) => r.payload.price)).toEqual(["2000000"]);

    // Outside the scope: no creating, no viewing, no editing, no moving a product out.
    await expect(createProduct(staff, productInput(notMine))).rejects.toBeInstanceOf(AuthzError);
    await expect(createProduct(staff, productInput(sub, { categoryIds: [notMine] }))).rejects.toBeInstanceOf(AuthzError);
    const foreign = await newProduct(ba, notMine, "50000");
    await expect(getProductForAdmin(staff, foreign.productId)).rejects.toBeInstanceOf(AuthzError);
    await expect(changePrice(staff, foreign.variantId, { price: "1", compareAtPrice: "" })).rejects.toBeInstanceOf(AuthzError);
    await expect(updateProduct(staff, created.id, { ...productInput(notMine) })).rejects.toBeInstanceOf(AuthzError);
    const listed = await listProductsForAdmin(staff, {});
    expect(listed.rows.map((r) => r.id)).toContain(created.id);
    expect(listed.rows.map((r) => r.id)).not.toContain(foreign.productId);

    // In scope: edits fine, archiving is a Business Admin permission.
    expect(await updateProduct(staff, created.id, productInput(sub))).toMatchObject({ status: "ok" });
    await expect(setProductStatus(staff, created.id, "archived")).rejects.toBeInstanceOf(AuthzError);
    const detail = await getProductForAdmin(staff, created.id);
    expect(detail?.can).toMatchObject({ edit: true, setPrice: false, proposePrice: true, archive: false, seeCost: false });
    await expect(changeCost(staff, variant!.id, { costPrice: "10" })).rejects.toBeInstanceOf(AuthzError);

    // One open request per variant; Staff can't approve.
    expect(await changePrice(staff, variant!.id, { price: "210000", compareAtPrice: "" })).toEqual({ status: "pending_exists" });
    const [request] = await listApprovalInbox(ba, "pending").then((rows) => rows.filter((r) => r.entityId === variant!.id));
    await expect(decidePriceRequest(staff, request!.id, "approve", "")).rejects.toBeInstanceOf(AuthzError);

    // The Business Admin approves: the price is applied with the approval recorded.
    expect(await decidePriceRequest(ba, request!.id, "approve", "ok")).toEqual({ status: "ok", outcome: "executed" });
    expect(await priceOf(variant!.id)).toBe("2000000");
    const [history] = await q<{ changed_by: string; approval_id: string }>(
      "SELECT changed_by, approval_id FROM product_prices WHERE variant_id = $1 AND price = 2000000",
      [variant!.id],
    );
    expect(history).toEqual({ changed_by: ba.userId, approval_id: request!.id });
    expect(await decidePriceRequest(ba, request!.id, "approve", "")).toEqual({ status: "already_decided" });
    const [row] = await q<{ status: string; decided_by: string }>("SELECT status::text, decided_by FROM admin_approvals WHERE id = $1", [request!.id]);
    expect(row).toEqual({ status: "executed", decided_by: ba.userId });
  });

  it("a request fails instead of overwriting a price changed since; requests can be rejected or withdrawn", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const staff = await actorFor("store_staff", [category]);
    const { variantId } = await newProduct(ba, category, "100000");

    const first = await changePrice(staff, variantId, { price: "120000", compareAtPrice: "" });
    if (first.status !== "proposed") throw new Error(first.status);
    expect(await changePrice(ba, variantId, { price: "110000", compareAtPrice: "" })).toEqual({ status: "applied" });
    expect(await decidePriceRequest(ba, first.approvalId, "approve", "")).toEqual({ status: "ok", outcome: "failed" });
    expect(await priceOf(variantId)).toBe("1100000");

    const second = await changePrice(staff, variantId, { price: "90000", compareAtPrice: "" });
    if (second.status !== "proposed") throw new Error(second.status);
    expect(await decidePriceRequest(ba, second.approvalId, "reject", "too low")).toEqual({ status: "ok", outcome: "rejected" });
    expect(await priceOf(variantId)).toBe("1100000");

    const third = await changePrice(staff, variantId, { price: "115000", compareAtPrice: "" });
    if (third.status !== "proposed") throw new Error(third.status);
    const otherStaff = await actorFor("store_staff", [category]);
    expect(await cancelOwnPriceRequest(otherStaff, third.approvalId)).toEqual({ status: "not_found" });
    expect(await cancelOwnPriceRequest(staff, third.approvalId)).toEqual({ status: "ok", outcome: "cancelled" });

    // Expired requests are closed, not applied.
    const fourth = await changePrice(staff, variantId, { price: "116000", compareAtPrice: "" });
    if (fourth.status !== "proposed") throw new Error(fourth.status);
    expect(await decidePriceRequest(ba, fourth.approvalId, "approve", "", new Date(Date.now() + 100 * 3_600_000))).toEqual({ status: "expired" });
    expect(await priceOf(variantId)).toBe("1100000");
  });

  it("the approved write itself checks the price, so a concurrent change is never overwritten", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const { variantId } = await newProduct(ba, category, "100000");
    const stale = { price: 999n, compareAtPrice: null };
    expect(await transaction((tx) => setVariantPriceIfUnchanged(tx, variantId, stale, { price: 5n, compareAtPrice: null }))).toBe(false);
    expect(await priceOf(variantId)).toBe("1000000");
  });

  it("a requester who loses the category no longer sees their old requests", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const staff = await actorFor("store_staff", [category]);
    const { variantId } = await newProduct(ba, category, "100000");
    const proposed = await changePrice(staff, variantId, { price: "101000", compareAtPrice: "" });
    if (proposed.status !== "proposed") throw new Error(proposed.status);
    expect((await listOwnApprovalRequests(staff)).map((r) => r.id)).toContain(proposed.approvalId);
    await q("DELETE FROM user_role_scopes WHERE user_role_id IN (SELECT id FROM user_roles WHERE user_id = $1)", [staff.userId]);
    staff.permissions = await loadEffectivePermissions(staff.userId);
    expect((await listOwnApprovalRequests(staff)).map((r) => r.id)).not.toContain(proposed.approvalId);
  });

  it("nobody decides their own request", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const staff = await actorFor("store_staff", [category]);
    const { variantId } = await newProduct(ba, category, "100000");
    const proposed = await changePrice(staff, variantId, { price: "101000", compareAtPrice: "" });
    if (proposed.status !== "proposed") throw new Error(proposed.status);
    // Even an actor who also holds price.update can't approve their own request.
    const both: Actor = { ...staff, permissions: new Map([...staff.permissions, ...ba.permissions]) };
    expect(await decidePriceRequest(both, proposed.approvalId, "approve", "")).toEqual({ status: "self" });
  });

  it("variants, SKUs and part numbers (normalized, unique)", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const { productId } = await newProduct(ba, category, "100000");
    const sku = `tst ${uid()}-b`;
    const variant = await addVariant(ba, productId, { sku, weightGrams: "۲۵۰", lengthMm: "", widthMm: "", heightMm: "", minOrderQty: "", maxOrderQty: "", isActive: true });
    if (variant.status !== "ok") throw new Error(variant.status);
    // A new variant starts switched off and can't be switched on before it has a price.
    expect((await q<{ is_active: boolean }>("SELECT is_active FROM product_variants WHERE id = $1", [variant.id]))[0]!.is_active).toBe(false);
    const details = { sku, weightGrams: "", lengthMm: "", widthMm: "", heightMm: "", minOrderQty: "", maxOrderQty: "", isActive: true };
    expect(await updateVariant(ba, variant.id, details)).toEqual({ status: "invalid", field: "variant_unpriced" });
    expect(await changePrice(ba, variant.id, { price: "50000", compareAtPrice: "" })).toEqual({ status: "applied" });
    expect(await updateVariant(ba, variant.id, details)).toMatchObject({ status: "ok" });
    expect(await addVariant(ba, productId, { sku: sku.toUpperCase().replace(" ", ""), weightGrams: "", lengthMm: "", widthMm: "", heightMm: "", minOrderQty: "", maxOrderQty: "", isActive: true })).toEqual({
      status: "taken",
      field: "sku",
    });
    expect(await addVariant(ba, productId, { sku: "x", weightGrams: "", lengthMm: "", widthMm: "", heightMm: "", minOrderQty: "5", maxOrderQty: "2", isActive: true })).toEqual({
      status: "invalid",
      field: "invalid_quantity",
    });

    const added = await addIdentifier(ba, productId, { type: "oem", value: "۱۲۳-ab 45", brandId: "" });
    if (added.status !== "ok") throw new Error(added.status);
    const [identifier] = await q<{ value: string; normalized_value: string }>("SELECT value, normalized_value FROM product_identifiers WHERE id = $1", [added.id]);
    expect(identifier).toEqual({ value: "123-ab 45", normalized_value: "123AB45" });
    expect(await addIdentifier(ba, productId, { type: "oem", value: "123AB45", brandId: "" })).toEqual({ status: "taken", field: "identifier" });
    expect(await addIdentifier(ba, productId, { type: "barcode", value: "12AB", brandId: "" })).toEqual({ status: "invalid", field: "invalid_barcode" });
    // Found by part number in the list, whatever the separators.
    expect((await listProductsForAdmin(ba, { q: "123 ab-45" })).rows.map((r) => r.id)).toContain(productId);
    expect(await removeIdentifier(ba, productId, added.id)).toMatchObject({ status: "ok" });
    expect(await removeIdentifier(ba, productId, added.id)).toEqual({ status: "not_found" });
  });

  it("cost prices are visible and editable only with a finance permission", async () => {
    const ba = await actorFor("business_admin");
    const { productId, variantId } = await newProduct(ba, await newCategory(ba), "100000");
    const hasFinance = ba.permissions.has("accounting.view") || ba.permissions.has("report.financial");
    if (hasFinance) {
      expect(await changeCost(ba, variantId, { costPrice: "70000" })).toEqual({ status: "applied" });
      expect((await getProductForAdmin(ba, productId))?.product.variants[0]?.costPrice).toBe(700000n);
    }
    const noFinance: Actor = { ...ba, permissions: new Map([...ba.permissions].filter(([k]) => k !== "accounting.view" && k !== "report.financial")) };
    expect((await getProductForAdmin(noFinance, productId))?.product.variants[0]?.costPrice).toBeNull();
    await expect(changeCost(noFinance, variantId, { costPrice: "1" })).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("Store Staff category scopes", () => {
  it("a Business Admin sets them; a scoped manager can't hand out categories they don't cover", async () => {
    const ba = await actorFor("business_admin");
    const a = await newCategory(ba);
    const b = await newCategory(ba);
    const staff = await actorFor("store_staff");
    expect(await setCategoryScopes(ba, staff.userId, [a])).toEqual({ status: "ok" });
    const refreshed = await loadEffectivePermissions(staff.userId);
    expect([...(refreshed.get("product.update")?.categoryIds ?? [])]).toEqual([a]);
    expect(await setCategoryScopes(ba, staff.userId, ["not-a-uuid"])).toEqual({ status: "invalid", field: "invalid_category" });

    // A Business Admin whose own product permissions cover only `a`.
    const narrowPerms = new Map(ba.permissions);
    for (const key of ["product.view", "product.create", "product.update", "category.manage", "price.update.propose", "media.upload", "compatibility.manage"]) {
      if (narrowPerms.has(key)) narrowPerms.set(key, { unscoped: false, categoryIds: new Set([a]), warehouseIds: new Set(), requiresMfa: false });
    }
    const narrow: Actor = { ...ba, permissions: narrowPerms };
    await expect(setCategoryScopes(narrow, staff.userId, [b])).rejects.toBeInstanceOf(AuthzError);
    // Store Staff can't set anyone's scopes.
    const other = await actorFor("store_staff", [a]);
    await expect(setCategoryScopes(other, staff.userId, [a])).rejects.toBeInstanceOf(AuthzError);
    const audit = await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'staff.scopes_changed'", [staff.userId]);
    expect(audit.length).toBe(1);
  });
});

describe("product photos", () => {
  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: "#e85d1a" } })
      .withExif({ IFD0: { Copyright: "secret-exif-marker" } })
      .png()
      .toBuffer();
  const file = async (width = 900, height = 600) => ({ name: "photo.png", bytes: new Uint8Array(await png(width, height)) });
  const noAlt = { fa: "", en: "" };
  const readAll = async (stream: ReadableStream<Uint8Array>) => Buffer.from(await new Response(stream).arrayBuffer());

  it("uploads are re-encoded to WebP sizes, served, ordered and removed", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const { productId } = await newProduct(ba, category);

    const first = await addProductImage(ba, productId, await file(), noAlt);
    if (first.status !== "ok") throw new Error(JSON.stringify(first));
    const second = await addProductImage(ba, productId, await file(1500, 1000), { fa: "نمای کنار", en: "Side view" });
    if (second.status !== "ok") throw new Error(JSON.stringify(second));

    let images = await listProductImagesForAdmin(ba, productId);
    expect(images.map((i) => i.id)).toEqual([first.id, second.id]);
    expect(images[0]!.isPrimary).toBe(true);
    // The alt text defaults to the product name.
    expect(images[0]!.alt.fa).toMatch(/^TEST لنت ترمز/);
    expect(images[0]!.renditions.map((r) => r.width)).toEqual([320, 640, 900]);
    expect(images[1]!.renditions.map((r) => r.width)).toEqual([320, 640, 1200, 1500]);

    // Served as WebP, without the original's metadata.
    const served = await openPublicImage(images[0]!.renditions[1]!.key);
    if (!served) throw new Error("not served");
    const body = await readAll(served.body);
    expect(body.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(body.includes("secret-exif-marker")).toBe(false);
    expect((await sharp(body).metadata()).width).toBe(640);

    expect(await reorderProductImage(ba, productId, second.id, "up")).toMatchObject({ status: "ok" });
    expect(await makePrimaryProductImage(ba, productId, second.id)).toMatchObject({ status: "ok" });
    expect(await updateProductImage(ba, productId, first.id, { fa: "  نمای   جلو ", en: "" })).toMatchObject({ status: "ok" });
    expect(await updateProductImage(ba, productId, first.id, { fa: "", en: "x" })).toEqual({ status: "invalid", field: "alt_fa_required" });
    images = await listProductImagesForAdmin(ba, productId);
    expect(images.map((i) => [i.id, i.isPrimary])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);
    expect(images[1]!.alt).toEqual({ fa: "نمای جلو" });

    // Removing the main photo makes the next one main and deletes the files.
    const removedKey = images[0]!.renditions[0]!.key;
    expect(await removeProductImage(ba, productId, second.id)).toMatchObject({ status: "ok" });
    expect(await openPublicImage(removedKey)).toBeNull();
    images = await listProductImagesForAdmin(ba, productId);
    expect(images.map((i) => [i.id, i.isPrimary])).toEqual([[first.id, true]]);
    expect(await removeProductImage(ba, productId, second.id)).toEqual({ status: "not_found" });

    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'product.image%' ORDER BY seq", [productId])).map((a) => a.action);
    expect(actions).toEqual(["product.image_added", "product.image_added", "product.image_moved", "product.image_primary", "product.image_updated", "product.image_removed"]);
  });

  it("refuses files that aren't usable photos", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const { productId } = await newProduct(ba, category);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await addProductImage(ba, productId, { name: "x.png", bytes: svg }, noAlt)).toEqual({ status: "invalid", field: "image_type" });
    // A PNG signature followed by garbage.
    const fake = new Uint8Array(4096);
    fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await addProductImage(ba, productId, { name: "x.png", bytes: fake }, noAlt)).toEqual({ status: "invalid", field: "image_type" });
    // Truncated real image.
    const real = await png(800, 800);
    expect(await addProductImage(ba, productId, { name: "x.png", bytes: new Uint8Array(real.subarray(0, real.length / 2)) }, noAlt)).toEqual({
      status: "invalid",
      field: "image_type",
    });
    expect(await addProductImage(ba, productId, await file(150, 600), noAlt)).toEqual({ status: "invalid", field: "image_too_small" });
    expect(await listProductImagesForAdmin(ba, productId)).toEqual([]);
    // Unknown, deleted or path-like keys are never served.
    expect(await openPublicImage("img/2026/01/../../../etc/passwd")).toBeNull();
    expect(await openPublicImage("img/2026/01/0193e9c2-7a4b-7c3d-8e9f-0123456789ab/640.webp")).toBeNull();
  });

  it("Store Staff manage photos only in their categories; others are refused", async () => {
    const ba = await actorFor("business_admin");
    const mine = await newCategory(ba);
    const other = await newCategory(ba);
    const staff = await actorFor("store_staff", [mine]);
    const inScope = await newProduct(ba, mine);
    const outOfScope = await newProduct(ba, other);

    const added = await addProductImage(staff, inScope.productId, await file(), noAlt);
    expect(added).toMatchObject({ status: "ok" });
    await expect(addProductImage(staff, outOfScope.productId, await file(), noAlt)).rejects.toBeInstanceOf(AuthzError);
    const baImage = await addProductImage(ba, outOfScope.productId, await file(), noAlt);
    if (baImage.status !== "ok") throw new Error(baImage.status);
    await expect(removeProductImage(staff, outOfScope.productId, baImage.id)).rejects.toBeInstanceOf(AuthzError);
    // An image id from another product is not found, even with the right product.
    expect(await removeProductImage(staff, inScope.productId, baImage.id)).toEqual({ status: "not_found" });
    // Staff with no categories can do nothing.
    const none = await actorFor("store_staff");
    await expect(addProductImage(none, inScope.productId, await file(), noAlt)).rejects.toBeInstanceOf(AuthzError);
    // A customer-like actor is refused.
    const customer: Actor = { ...staff, kind: "customer", level: null, permissions: new Map() };
    await expect(addProductImage(customer, inScope.productId, await file(), noAlt)).rejects.toBeInstanceOf(AuthzError);
    expect((await listProductImagesForAdmin(ba, outOfScope.productId)).length).toBe(1);
    // Every other change to an out-of-scope photo is refused too.
    await expect(updateProductImage(staff, outOfScope.productId, baImage.id, { fa: "x", en: "" })).rejects.toBeInstanceOf(AuthzError);
    await expect(makePrimaryProductImage(staff, outOfScope.productId, baImage.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(reorderProductImage(staff, outOfScope.productId, baImage.id, "up")).rejects.toBeInstanceOf(AuthzError);
    // product.update without media.upload can't add photos.
    const noUpload: Actor = { ...ba, permissions: new Map([...ba.permissions].filter(([key]) => key !== "media.upload")) };
    await expect(addProductImage(noUpload, inScope.productId, await file(), noAlt)).rejects.toBeInstanceOf(AuthzError);
  });

  it("refuses images above the pixel limit and counts every use before deleting", async () => {
    const ba = await actorFor("business_admin");
    const category = await newCategory(ba);
    const { productId } = await newProduct(ba, category);
    // 8000 × 6000 = 48 MP, a small file that would decode to ~144 MB.
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(2_000_000);
    expect(await addProductImage(ba, productId, { name: "bomb.png", bytes: new Uint8Array(bomb) }, noAlt)).toEqual({ status: "invalid", field: "image_type" });

    // An image still referenced elsewhere (here a category) is not deleted when one use goes away.
    const added = await addProductImage(ba, productId, await file(), noAlt);
    if (added.status !== "ok") throw new Error(added.status);
    const [{ media_id: mediaId }] = (await q<{ media_id: string }>("SELECT media_id FROM product_images WHERE id = $1", [added.id])) as [{ media_id: string }];
    await q("UPDATE categories SET image_media_id = $1 WHERE id = $2", [mediaId, category]);
    expect(await removeProductImage(ba, productId, added.id)).toMatchObject({ status: "ok" });
    const key = (await imageRenditions(mediaId))[0]!.key;
    expect(await openPublicImage(key)).not.toBeNull();
    expect(await setCategoryImage(ba, category, null)).toEqual({ status: "ok" });
    expect(await openPublicImage(key)).toBeNull();
  });

  it("brand logos and category pictures can be set, replaced and removed", async () => {
    const ba = await actorFor("business_admin");
    const brand = await createBrand(ba, { ...names("برند"), isGenuine: false, isActive: true, sortOrder: "0" });
    if (brand.status !== "ok") throw new Error(brand.status);
    const logo = async () => (await q<{ logo_media_id: string | null }>("SELECT logo_media_id FROM brands WHERE id = $1", [brand.id]))[0]!.logo_media_id;

    expect(await setBrandLogo(ba, brand.id, await file())).toEqual({ status: "ok" });
    const firstMedia = (await logo())!;
    const firstKey = (await imageRenditions(firstMedia))[0]!.key;
    expect(await openPublicImage(firstKey)).not.toBeNull();
    expect(await setBrandLogo(ba, brand.id, await file(600, 600))).toEqual({ status: "ok" });
    expect(await logo()).not.toBe(firstMedia);
    // The replaced logo's files are gone.
    expect(await openPublicImage(firstKey)).toBeNull();
    expect(await setBrandLogo(ba, brand.id, null)).toEqual({ status: "ok" });
    expect(await logo()).toBeNull();

    const category = await newCategory(ba);
    const other = await newCategory(ba);
    const staff = await actorFor("store_staff", [category]);
    // Store Staff may picture their categories, but not brands (a brand has no category) or other categories.
    expect(await setCategoryImage(staff, category, await file())).toEqual({ status: "ok" });
    await expect(setCategoryImage(staff, other, await file())).rejects.toBeInstanceOf(AuthzError);
    await expect(setBrandLogo(staff, brand.id, await file())).rejects.toBeInstanceOf(AuthzError);
    // ...nor remove them.
    expect(await setBrandLogo(ba, brand.id, await file())).toEqual({ status: "ok" });
    await expect(setBrandLogo(staff, brand.id, null)).rejects.toBeInstanceOf(AuthzError);
    expect(await logo()).not.toBeNull();
    expect(await setCategoryImage(ba, other, await file())).toEqual({ status: "ok" });
    await expect(setCategoryImage(staff, other, null)).rejects.toBeInstanceOf(AuthzError);
    expect(await setCategoryImage(ba, category, { name: "x", bytes: new TextEncoder().encode("not an image at all") })).toEqual({ status: "invalid", field: "image_type" });
    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq", [brand.id])).map((a) => a.action);
    expect(actions.filter((a) => a === "brand.logo_changed").length).toBe(4);
  });
});
