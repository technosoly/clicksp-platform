import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory, updateCategory } from "@/modules/catalog/service/categories";
import { addIdentifier, createProduct, setProductStatus } from "@/modules/catalog/service/products";
import { categoryPage, productCardsByIds, productPage, searchShop, shopHome } from "@/modules/catalog/service/storefront";
import { addFitment, decideFitment } from "@/modules/compatibility/service/fitment";
import { fitmentChoice, productIdsFitting, shopFitment } from "@/modules/compatibility/service/shop-fitment";
import { createWarehouse, getWarehouseForAdmin } from "@/modules/inventory/service/warehouses";
import { recordMovement, shopAvailability } from "@/modules/inventory/service/stock";
import type { Actor } from "@/modules/rbac/domain/actor";
import {
  createGeneration,
  createManufacturer,
  createModel,
  createMotorcycleBrand,
  createMotorcycleVariant,
  updateModel,
} from "@/modules/vehicles/service/motorcycles";
import { shopMotorcycleBrands, shopMotorcycleModel } from "@/modules/vehicles/service/shop";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

const categoryInput = (parentId = "") => ({ ...testNames("دسته"), parentId, isVehicleSystem: false, isActive: true, sortOrder: "0" });

async function product(actor: Actor, categoryId: string, title: string, publish = true) {
  const created = ok(
    await createProduct(actor, {
      faTitle: title,
      faSlug: "",
      faShort: "",
      enTitle: `TEST part ${uid()}`,
      enSlug: "",
      enShort: "",
      brandId: "",
      primaryCategoryId: categoryId,
      categoryIds: [],
      warrantyMonths: "6",
      sku: `SHOP-${uid()}`,
      price: "250000",
      compareAtPrice: "",
    }),
  );
  if (publish) ok(await setProductStatus(actor, created.id, "active"));
  const [row] = await q<{ fa: string; en: string; variant: string; sku: string }>(
    `SELECT (SELECT slug FROM product_translations WHERE product_id = $1 AND locale = 'fa') AS fa,
            (SELECT slug FROM product_translations WHERE product_id = $1 AND locale = 'en') AS en,
            v.id AS variant, v.sku
       FROM product_variants v WHERE v.product_id = $1`,
    [created.id],
  );
  return { id: created.id, slugFa: row!.fa, slugEn: row!.en, variantId: row!.variant, sku: row!.sku };
}

async function motorcycle(actor: Actor) {
  const manufacturer = ok(await createManufacturer(actor, { ...testNames("سازنده"), countryCode: "", isActive: true, sortOrder: "" }));
  const brand = ok(await createMotorcycleBrand(actor, { ...testNames("برند"), manufacturerId: manufacturer.id, isActive: true, sortOrder: "0" }));
  const modelInput = { ...testNames("مدل"), brandId: brand.id, segment: "standard", isActive: true, sortOrder: "0" };
  const model = ok(await createModel(actor, modelInput));
  const generation = ok(await createGeneration(actor, model.id, { code: "", yearFrom: "2008", yearTo: "2015" }));
  const variant = ok(
    await createMotorcycleVariant(actor, {
      generationId: generation.id,
      faName: `TEST نسخه ${uid()}`,
      enName: "",
      code: "",
      engineDisplacementCc: "125",
      engineStroke: "four_stroke",
      cylinders: "1",
      cooling: "air",
      fuelSystem: "carburetor",
      marketCode: "",
      yearFrom: "",
      yearTo: "",
      isActive: true,
    }),
  );
  const [slug] = await q<{ slug: string }>("SELECT slug FROM motorcycle_model_translations WHERE model_id = $1 AND locale = 'fa'", [model.id]);
  return { modelId: model.id, modelInput, generationId: generation.id, variantId: variant.id, slug: slug!.slug };
}

const source = { type: "oem_catalog", title: "TEST catalogue", reference: "", url: "" };

describe("storefront catalog", () => {
  it("shows only published products, in their category tree, with a locale fallback", async () => {
    const ba = await actorFor("business_admin");
    const parent = ok(await createCategory(ba, categoryInput()));
    const child = ok(await createCategory(ba, categoryInput(parent.id)));
    const published = await product(ba, child.id, `TEST لنت ترمز ${uid()}`);
    const draft = await product(ba, child.id, `TEST پیش‌نویس ${uid()}`, false);

    const [parentSlug] = await q<{ slug: string }>("SELECT slug FROM category_translations WHERE category_id = $1 AND locale = 'fa'", [parent.id]);
    const page = await categoryPage("fa", parentSlug!.slug, 1);
    expect(page?.children.map((c) => c.id)).toEqual([child.id]);
    expect(page?.products.map((p) => p.id)).toEqual([published.id]);
    expect(page?.products[0]).toMatchObject({ price: 250000n * 10n, sku: published.sku });

    expect(await productPage("fa", draft.slugFa)).toBeNull();
    const shown = await productPage("en", published.slugFa);
    // A Persian slug under /en still finds the product and links its English slug.
    expect(shown).toMatchObject({ id: published.id, slug: published.slugEn, warrantyMonths: 6 });
    expect(shown?.alternates).toEqual({ fa: published.slugFa, en: published.slugEn });
    expect(shown?.images).toEqual([]);

    const home = await shopHome("fa");
    expect(home.latest.some((p) => p.id === published.id)).toBe(true);
    expect(home.latest.some((p) => p.id === draft.id)).toBe(false);

    // A switched-off category disappears, and so does its page.
    ok(await updateCategory(ba, child.id, { ...categoryInput(parent.id), isActive: false }));
    const [childSlug] = await q<{ slug: string }>("SELECT slug FROM category_translations WHERE category_id = $1 AND locale = 'fa'", [child.id]);
    expect(await categoryPage("fa", childSlug!.slug, 1)).toBeNull();
  });

  it("hides a category whose parent is switched off, and a switched-off variant's SKU", async () => {
    const ba = await actorFor("business_admin");
    const parent = ok(await createCategory(ba, categoryInput()));
    const child = ok(await createCategory(ba, categoryInput(parent.id)));
    const p = await product(ba, child.id, `TEST زیرشاخه ${uid()}`);
    const [childSlug] = await q<{ slug: string }>("SELECT slug FROM category_translations WHERE category_id = $1 AND locale = 'fa'", [child.id]);
    expect((await categoryPage("fa", childSlug!.slug, 1))?.id).toBe(child.id);
    expect((await productPage("fa", p.slugFa))?.category).not.toBeNull();

    ok(await updateCategory(ba, parent.id, { ...categoryInput(), isActive: false }));
    expect(await categoryPage("fa", childSlug!.slug, 1)).toBeNull();
    expect((await productPage("fa", p.slugFa))?.category).toBeNull();

    // A second, switched-off variant: its SKU finds nothing.
    const hiddenSku = `HID-${uid()}`;
    await q(
      "INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, is_active, price) VALUES ($1, $2::text, upper(replace($2::text, '-', '')), false, false, 1000)",
      [p.id, hiddenSku],
    );
    expect((await searchShop("fa", hiddenSku, 1)).total).toBe(0);
    await q("UPDATE product_variants SET is_active = true WHERE sku = $1", [hiddenSku]);
    expect((await searchShop("fa", hiddenSku, 1)).products.map((x) => x.id)).toEqual([p.id]);
  });

  it("finds parts by title, SKU or part number, whatever the separators and digits", async () => {
    const ba = await actorFor("business_admin");
    const category = ok(await createCategory(ba, categoryInput()));
    const word = `زنجیرک${uid().toLowerCase()}`;
    const p = await product(ba, category.id, `TEST ${word} موتور`);
    const oem = `${Math.floor(Math.random() * 1e6)}-KPH-${uid()}`;
    ok(await addIdentifier(ba, p.id, { type: "oem", value: oem, brandId: "" }));
    const draft = await product(ba, category.id, `TEST ${word} پیش‌نویس`, false);

    const byTitle = await searchShop("fa", word, 1);
    expect(byTitle.products.map((x) => x.id)).toEqual([p.id]);
    expect((await searchShop("fa", p.sku.toLowerCase(), 1)).products.map((x) => x.id)).toEqual([p.id]);
    const spaced = oem.replace(/-/g, " ").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
    expect((await searchShop("fa", spaced, 1)).products.map((x) => x.id)).toEqual([p.id]);
    expect((await searchShop("fa", "x", 1)).total).toBe(0);
    expect((await searchShop("fa", word, 1)).products.some((x) => x.id === draft.id)).toBe(false);
    const shown = await productPage("fa", p.slugFa);
    expect(shown?.identifiers.map((i) => i.type)).toEqual(["oem"]);
  });

  it("says in stock, low or out from sellable stock only", async () => {
    const ba = await actorFor("business_admin");
    const category = ok(await createCategory(ba, categoryInput()));
    const p = await product(ba, category.id, `TEST موجودی ${uid()}`);
    const w = ok(await createWarehouse(ba, { code: `s-${uid()}`, name: "TEST", city: "", address: "", phone: "", priority: "", isActive: true }));
    const location = (await getWarehouseForAdmin(ba, w.id))!.locations[0]!.id;
    expect((await shopAvailability([p.variantId])).get(p.variantId)).toBe("out");
    ok(await recordMovement(ba, p.id, { kind: "receive", variantId: p.variantId, locationId: location, quantity: "2", reference: "", reason: "", adjustmentReason: "" }));
    expect((await shopAvailability([p.variantId])).get(p.variantId)).toBe("low");
    ok(await recordMovement(ba, p.id, { kind: "receive", variantId: p.variantId, locationId: location, quantity: "10", reference: "", reason: "", adjustmentReason: "" }));
    expect((await shopAvailability([p.variantId])).get(p.variantId)).toBe("in_stock");
  });
});

describe("storefront fitment", () => {
  it("lists and finds only verified fitment, by model, years and engine version", async () => {
    const ba = await actorFor("business_admin");
    const category = ok(await createCategory(ba, categoryInput()));
    const m = await motorcycle(ba);
    const wholeGen = await product(ba, category.id, `TEST فیلتر ${uid()}`);
    const someYears = await product(ba, category.id, `TEST شمع ${uid()}`);
    const unverified = await product(ba, category.id, `TEST تأییدنشده ${uid()}`);

    const a = ok(await addFitment(ba, wholeGen.id, { target: `g:${m.generationId}`, yearFrom: "", yearTo: "", position: "any", quantity: "", notes: "", sourceId: "" }, source));
    const b = ok(await addFitment(ba, someYears.id, { target: `v:${m.variantId}`, yearFrom: "2010", yearTo: "2011", position: "front", quantity: "2", notes: "", sourceId: "" }, source));
    ok(await addFitment(ba, unverified.id, { target: `g:${m.generationId}`, yearFrom: "", yearTo: "", position: "any", quantity: "", notes: "", sourceId: "" }, source));
    ok(await decideFitment(ba, wholeGen.id, a.id, "verified"));
    ok(await decideFitment(ba, someYears.id, b.id, "verified"));

    const all = await productIdsFitting(m.modelId, fitmentChoice({}));
    expect(new Set(all)).toEqual(new Set([wholeGen.id, someYears.id]));
    // Solar year 1389 is 2010; 2013 is outside the narrowed link.
    expect(new Set(await productIdsFitting(m.modelId, fitmentChoice({ y: "۱۳۸۹" })))).toEqual(new Set([wholeGen.id, someYears.id]));
    expect(await productIdsFitting(m.modelId, fitmentChoice({ y: "2013" }))).toEqual([wholeGen.id]);
    expect(await productIdsFitting(m.modelId, fitmentChoice({ y: "2030" }))).toEqual([]);
    expect(new Set(await productIdsFitting(m.modelId, fitmentChoice({ g: m.generationId, v: m.variantId })))).toEqual(new Set([wholeGen.id, someYears.id]));
    expect(await productIdsFitting(m.modelId, fitmentChoice({ g: "not-a-uuid" }))).toHaveLength(2);

    const listed = await shopFitment("fa", someYears.id);
    expect(listed).toMatchObject([{ yearFrom: 2010, yearTo: 2011, position: "front", quantity: 2, cc: 125 }]);
    expect(await shopFitment("fa", unverified.id)).toEqual([]);

    const cards = await productCardsByIds("fa", all, 1);
    expect(cards.total).toBe(2);

    const model = await shopMotorcycleModel("fa", m.slug);
    expect(model?.generations[0]).toMatchObject({ yearFrom: 2008, yearTo: 2015 });
    expect((await shopMotorcycleBrands("fa")).some((x) => x.models.some((y) => y.id === m.modelId))).toBe(true);
    // A switched-off model is gone from the shop.
    ok(await updateModel(ba, m.modelId, { ...m.modelInput, isActive: false }));
    expect(await shopMotorcycleModel("fa", m.slug)).toBeNull();
  });
});
