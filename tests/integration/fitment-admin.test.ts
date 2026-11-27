import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createCategory } from "@/modules/catalog/service/categories";
import { createProduct } from "@/modules/catalog/service/products";
import { addFitment, decideFitment, fitmentForAdmin, removeFitment } from "@/modules/compatibility/service/fitment";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError } from "@/modules/rbac/service/authorize";
import {
  createGeneration,
  createManufacturer,
  createModel,
  createMotorcycleBrand,
  createMotorcycleVariant,
  getModelForAdmin,
  listManufacturersForAdmin,
  motorcyclePicker,
  updateGeneration,
  updateMotorcycleVariant,
} from "@/modules/vehicles/service/motorcycles";
import { actorFor, q, testNames } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

const variantInput = (generationId: string, extra: Record<string, string> = {}) => ({
  generationId,
  faName: `TEST نسخه ${uid()}`,
  enName: "",
  code: "",
  engineDisplacementCc: "۱۲۵",
  engineStroke: "four_stroke",
  cylinders: "1",
  cooling: "air",
  fuelSystem: "carburetor",
  marketCode: "ir",
  yearFrom: "",
  yearTo: "",
  isActive: true,
  ...extra,
});

/** A manufacturer > brand > model with one generation (2008–2015) and one variant. */
async function motorcycle(actor: Actor) {
  const manufacturer = ok(await createManufacturer(actor, { ...testNames("سازنده"), countryCode: "ir", isActive: true, sortOrder: "" }));
  const brand = ok(await createMotorcycleBrand(actor, { ...testNames("برند"), manufacturerId: manufacturer.id, isActive: true, sortOrder: "0" }));
  const model = ok(await createModel(actor, { ...testNames("مدل"), brandId: brand.id, segment: "standard", isActive: true, sortOrder: "0" }));
  // Solar years: 1387 → 2008, 1394 → 2015.
  const generation = ok(await createGeneration(actor, model.id, { code: "", yearFrom: "۱۳۸۷", yearTo: "1394" }));
  const variant = ok(await createMotorcycleVariant(actor, variantInput(generation.id)));
  return { manufacturerId: manufacturer.id, brandId: brand.id, modelId: model.id, generationId: generation.id, variantId: variant.id };
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
  return { productId: created.id, categoryId: category.id };
}

const link = (target: string, extra: Record<string, string> = {}) => ({
  target,
  yearFrom: "",
  yearTo: "",
  position: "any" as const,
  quantity: "",
  notes: "",
  sourceId: "",
  ...extra,
});
const source = { type: "oem_catalog", title: "TEST catalogue", reference: "p. 12", url: "" };
const noSource = { type: "", title: "", reference: "", url: "" };

describe("motorcycle catalog", () => {
  it("admins build maker > brand > model > years > engine versions; years are stored Gregorian", async () => {
    const ba = await actorFor("business_admin");
    const m = await motorcycle(ba);
    const [generation] = await q<{ year_from: number; year_to: number }>("SELECT year_from, year_to FROM motorcycle_generations WHERE id = $1", [m.generationId]);
    expect(generation).toEqual({ year_from: 2008, year_to: 2015 });
    const [variant] = await q<{ engine_displacement_cc: number; market_code: string }>("SELECT engine_displacement_cc, market_code FROM motorcycle_variants WHERE id = $1", [m.variantId]);
    expect(variant).toEqual({ engine_displacement_cc: 125, market_code: "IR" });

    const model = await getModelForAdmin(ba, m.modelId);
    expect(model?.model.generations[0]?.variants.map((v) => v.id)).toEqual([m.variantId]);
    expect((await listManufacturersForAdmin(ba)).some((x) => x.id === m.manufacturerId)).toBe(true);

    // A variant's years must lie inside its generation; narrowing a generation can't strand them.
    expect(await createMotorcycleVariant(ba, variantInput(m.generationId, { yearFrom: "2016" }))).toEqual({ status: "invalid", field: "variant_years_outside" });
    ok(await updateMotorcycleVariant(ba, m.variantId, variantInput(m.generationId, { yearFrom: "2010", yearTo: "2012" })));
    expect(await updateGeneration(ba, m.generationId, { code: "", yearFrom: "2011", yearTo: "2015" })).toEqual({ status: "invalid", field: "generation_years_in_use" });
    expect(await createGeneration(ba, m.modelId, { code: "", yearFrom: "2015", yearTo: "2010" })).toEqual({ status: "invalid", field: "invalid_year_range" });
    expect(await createGeneration(ba, m.modelId, { code: "", yearFrom: "99", yearTo: "" })).toEqual({ status: "invalid", field: "invalid_year" });
    // A variant can't be moved to another model's generation.
    const other = await motorcycle(ba);
    expect(await updateMotorcycleVariant(ba, m.variantId, variantInput(other.generationId))).toEqual({ status: "invalid", field: "invalid_generation" });

    const audit = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq", [m.variantId]);
    expect(audit.map((a) => a.action)).toEqual(["motorcycle.variant_created", "motorcycle.variant_updated"]);
  });

  it("every admin level manages motorcycles; others are refused", async () => {
    const staff = await actorFor("store_staff");
    await motorcycle(staff);
    const customer: Actor = { ...staff, kind: "customer", level: null, permissions: new Map() };
    await expect(listManufacturersForAdmin(customer)).rejects.toBeInstanceOf(AuthzError);
    await expect(createManufacturer(customer, { ...testNames("x"), countryCode: "", isActive: true, sortOrder: "" })).rejects.toBeInstanceOf(AuthzError);
    const noVehicle: Actor = { ...staff, permissions: new Map([...staff.permissions].filter(([key]) => key !== "vehicle.manage" && key !== "compatibility.manage")) };
    await expect(motorcyclePicker(noVehicle)).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("fitment", () => {
  it("staff link parts in their categories as unverified; a manager verifies; verified links are protected", async () => {
    const ba = await actorFor("business_admin");
    const m = await motorcycle(ba);
    const { productId, categoryId } = await product(ba);
    const staff = await actorFor("store_staff", [categoryId]);

    const byGeneration = ok(await addFitment(staff, productId, link(`g:${m.generationId}`, { yearFrom: "1389", yearTo: "1392" }), source));
    const byVariant = ok(await addFitment(staff, productId, link(`v:${m.variantId}`, { position: "front", quantity: "2" }), source));
    let view = await fitmentForAdmin(staff, productId);
    expect(view?.links.map((l) => [l.id, l.status])).toEqual([
      [byGeneration.id, "unverified"],
      [byVariant.id, "unverified"],
    ]);
    expect(view?.links[0]).toMatchObject({ yearFrom: 2010, yearTo: 2013 });
    expect(view?.can).toEqual({ manage: true, verify: false });

    // The same claim twice, years outside the generation, no source, unknown motorcycle.
    expect(await addFitment(staff, productId, link(`v:${m.variantId}`, { position: "front" }), source)).toEqual({ status: "duplicate" });
    expect(await addFitment(staff, productId, link(`g:${m.generationId}`, { yearFrom: "2016" }), source)).toEqual({ status: "invalid", field: "years_outside_generation" });
    expect(await addFitment(staff, productId, link(`v:${m.variantId}`, { position: "rear" }), noSource)).toEqual({ status: "invalid", field: "source_required" });
    expect(await addFitment(staff, productId, link("v:0193e9c2-7a4b-7c3d-8e9f-0123456789ab"), source)).toEqual({ status: "invalid", field: "motorcycle_required" });
    expect(await addFitment(staff, productId, link(`v:${m.variantId}`, { position: "rear" }), { ...source, url: "javascript:alert(1)" })).toEqual({
      status: "invalid",
      field: "invalid_url",
    });
    // An existing source can be reused.
    const sourceId = (await q<{ source_id: string }>("SELECT source_id FROM product_compatibilities WHERE id = $1", [byVariant.id]))[0]!.source_id;
    ok(await addFitment(staff, productId, link(`v:${m.variantId}`, { position: "rear", sourceId }), noSource));

    // Staff can't verify; a Business Admin can.
    await expect(decideFitment(staff, productId, byVariant.id, "verified")).rejects.toBeInstanceOf(AuthzError);
    ok(await decideFitment(ba, productId, byVariant.id, "verified"));
    view = await fitmentForAdmin(ba, productId);
    expect(view?.links.find((l) => l.id === byVariant.id)).toMatchObject({ status: "verified", verifiedBy: "TEST ADMIN" });
    // Staff can remove an unverified link but not a verified one.
    await expect(removeFitment(staff, productId, byVariant.id)).rejects.toBeInstanceOf(AuthzError);
    ok(await removeFitment(staff, productId, byGeneration.id));
    ok(await decideFitment(ba, productId, byVariant.id, "disputed"));
    const [row] = await q<{ verification_status: string; verified_by: string | null }>("SELECT verification_status, verified_by FROM product_compatibilities WHERE id = $1", [byVariant.id]);
    expect(row).toEqual({ verification_status: "disputed", verified_by: null });
    ok(await removeFitment(ba, productId, byVariant.id));
    expect(await removeFitment(ba, productId, byVariant.id)).toEqual({ status: "not_found" });

    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'product_compatibility' AND entity_id = $1 ORDER BY seq", [byVariant.id])).map((a) => a.action);
    expect(actions).toEqual(["fitment.created", "fitment.verified", "fitment.disputed", "fitment.removed"]);
  });

  it("refuses links outside the staff member's categories and links of other products", async () => {
    const ba = await actorFor("business_admin");
    const m = await motorcycle(ba);
    const mine = await product(ba);
    const other = await product(ba);
    const staff = await actorFor("store_staff", [mine.categoryId]);
    await expect(addFitment(staff, other.productId, link(`v:${m.variantId}`), source)).rejects.toBeInstanceOf(AuthzError);
    await expect(fitmentForAdmin(staff, other.productId)).rejects.toBeInstanceOf(AuthzError);
    const foreign = ok(await addFitment(ba, other.productId, link(`v:${m.variantId}`), source));
    // A link id of another product is not found through this product.
    expect(await removeFitment(staff, mine.productId, foreign.id)).toEqual({ status: "not_found" });
    expect(await decideFitment(ba, mine.productId, foreign.id, "verified")).toEqual({ status: "not_found" });
    const unscopedStaff = await actorFor("store_staff");
    await expect(addFitment(unscopedStaff, mine.productId, link(`v:${m.variantId}`), source)).rejects.toBeInstanceOf(AuthzError);
    expect(await decideFitment(ba, mine.productId, foreign.id, "approved")).toEqual({ status: "invalid", field: "invalid_status" });
  });
});
