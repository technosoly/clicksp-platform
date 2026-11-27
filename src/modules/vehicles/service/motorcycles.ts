import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import {
  generationInputSchema,
  manufacturerInputSchema,
  modelInputSchema,
  motorcycleBrandInputSchema,
  variantInputSchema,
  type GenerationInput,
  type ManufacturerInput,
  type ModelInput,
  type MotorcycleBrandInput,
  type VariantInput,
} from "../domain/vehicle-input";
import {
  brandExists,
  databaseMessage,
  getGeneration,
  getManufacturer,
  getModel,
  getMotorcycleBrand,
  getMotorcycleVariant,
  insertGeneration,
  insertManufacturer,
  insertModel,
  insertMotorcycleBrand,
  insertMotorcycleVariant,
  isUniqueViolation,
  listManufacturersWithBrands,
  manufacturerExists,
  motorcyclePickerRows,
  updateGenerationRow,
  updateManufacturerRow,
  updateModelRow,
  updateMotorcycleBrandRow,
  updateMotorcycleVariantRow,
} from "../repo/vehicles-repo";

/**
 * The motorcycle catalog (vehicle.manage): manufacturers > brands > models >
 * generations (years) > variants (engine, market). Real data only: nothing
 * is seeded. Every change is audited.
 */

export type VehicleResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "taken" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminId(actor: Actor): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("vehicle.manage", "not_admin");
  return actor.userId;
}

async function allow(actor: Actor, stepUp = true): Promise<string> {
  const id = adminId(actor);
  await authorize(actor, "vehicle.manage", { type: "motorcycle" }, { stepUp });
  return id;
}

function failure(error: unknown): VehicleResult {
  if (isUniqueViolation(error)) return { status: "taken" };
  const message = databaseMessage(error);
  if (message.includes("slug_format")) return { status: "invalid", field: "invalid_slug" };
  if (message.includes("outside its generation")) return { status: "invalid", field: "variant_years_outside" };
  if (message.includes("would exclude existing")) return { status: "invalid", field: "generation_years_in_use" };
  if (message.includes("_years") || message.includes("_displacement") || message.includes("_cylinders")) return { status: "invalid", field: "invalid_year_range" };
  throw error;
}

async function write(actor: Actor, userId: string, action: string, entityType: string, fn: (tx: Parameters<Parameters<typeof transaction>[0]>[0]) => Promise<string>, after: unknown): Promise<VehicleResult> {
  try {
    const id = await transaction(async (tx) => {
      const id = await fn(tx);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action, entityType, entityId: id, after });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}

const first = (issues: { message: string }[]) => issues[0]?.message ?? "invalid";

// Reads ----------------------------------------------------------------------

export async function listManufacturersForAdmin(actor: Actor) {
  await allow(actor, false);
  return listManufacturersWithBrands(db());
}

export async function getManufacturerForAdmin(actor: Actor, id: string) {
  await allow(actor, false);
  return UUID.test(id) ? getManufacturer(db(), id) : null;
}

export async function getMotorcycleBrandForAdmin(actor: Actor, id: string) {
  await allow(actor, false);
  if (!UUID.test(id)) return null;
  const brand = await getMotorcycleBrand(db(), id);
  if (!brand) return null;
  const manufacturers = (await listManufacturersWithBrands(db())).map((m) => ({ id: m.id, names: m.names, isActive: m.isActive }));
  return { brand, manufacturers };
}

export async function getModelForAdmin(actor: Actor, id: string) {
  await allow(actor, false);
  if (!UUID.test(id)) return null;
  const model = await getModel(db(), id);
  if (!model) return null;
  const brands = (await listManufacturersWithBrands(db())).flatMap((m) => m.brands.map((b) => ({ id: b.id, names: b.names, isActive: b.isActive })));
  return { model, brands };
}

/**
 * Motorcycles to pick from when linking a part. Readable by anyone who can
 * manage fitment (or the motorcycle catalog).
 */
export async function motorcyclePicker(actor: Actor) {
  adminId(actor);
  if (!actor.permissions.has("compatibility.manage")) await allow(actor, false);
  return motorcyclePickerRows(db());
}

// Manufacturers ----------------------------------------------------------------

export async function createManufacturer(actor: Actor, input: ManufacturerInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "motorcycle.manufacturer_created", "motorcycle_manufacturer", (tx) => insertManufacturer(tx, parsed.data), parsed.data);
}

export async function updateManufacturer(actor: Actor, id: string, input: ManufacturerInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  if (!UUID.test(id) || !(await getManufacturer(db(), id))) return { status: "not_found" };
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "motorcycle.manufacturer_updated", "motorcycle_manufacturer", async (tx) => {
    await updateManufacturerRow(tx, id, parsed.data);
    return id;
  }, parsed.data);
}

// Brands -----------------------------------------------------------------------

export async function createMotorcycleBrand(actor: Actor, input: MotorcycleBrandInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  const parsed = motorcycleBrandInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  if (!(await manufacturerExists(db(), parsed.data.manufacturerId))) return { status: "invalid", field: "invalid_manufacturer" };
  return write(actor, userId, "motorcycle.brand_created", "motorcycle_brand", (tx) => insertMotorcycleBrand(tx, parsed.data), parsed.data);
}

export async function updateMotorcycleBrand(actor: Actor, id: string, input: MotorcycleBrandInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  if (!UUID.test(id) || !(await brandExists(db(), id))) return { status: "not_found" };
  const parsed = motorcycleBrandInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  if (!(await manufacturerExists(db(), parsed.data.manufacturerId))) return { status: "invalid", field: "invalid_manufacturer" };
  return write(actor, userId, "motorcycle.brand_updated", "motorcycle_brand", async (tx) => {
    await updateMotorcycleBrandRow(tx, id, parsed.data);
    return id;
  }, parsed.data);
}

// Models -----------------------------------------------------------------------

export async function createModel(actor: Actor, input: ModelInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  const parsed = modelInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  if (!(await brandExists(db(), parsed.data.brandId))) return { status: "invalid", field: "invalid_brand" };
  return write(actor, userId, "motorcycle.model_created", "motorcycle_model", (tx) => insertModel(tx, parsed.data), parsed.data);
}

export async function updateModel(actor: Actor, id: string, input: ModelInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  if (!UUID.test(id) || !(await getModel(db(), id))) return { status: "not_found" };
  const parsed = modelInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  if (!(await brandExists(db(), parsed.data.brandId))) return { status: "invalid", field: "invalid_brand" };
  return write(actor, userId, "motorcycle.model_updated", "motorcycle_model", async (tx) => {
    await updateModelRow(tx, id, parsed.data);
    return id;
  }, parsed.data);
}

// Generations and variants ----------------------------------------------------

export async function createGeneration(actor: Actor, modelId: string, input: GenerationInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  if (!UUID.test(modelId) || !(await getModel(db(), modelId))) return { status: "not_found" };
  const parsed = generationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "motorcycle.generation_created", "motorcycle_generation", (tx) => insertGeneration(tx, modelId, parsed.data), { modelId, ...parsed.data });
}

export async function updateGeneration(actor: Actor, id: string, input: GenerationInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  if (!UUID.test(id) || !(await getGeneration(db(), id))) return { status: "not_found" };
  const parsed = generationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  return write(actor, userId, "motorcycle.generation_updated", "motorcycle_generation", async (tx) => {
    await updateGenerationRow(tx, id, parsed.data);
    return id;
  }, parsed.data);
}

export async function createMotorcycleVariant(actor: Actor, input: VariantInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  const parsed = variantInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  if (!(await getGeneration(db(), parsed.data.generationId))) return { status: "invalid", field: "invalid_generation" };
  return write(actor, userId, "motorcycle.variant_created", "motorcycle_variant", (tx) => insertMotorcycleVariant(tx, parsed.data), parsed.data);
}

export async function updateMotorcycleVariant(actor: Actor, id: string, input: VariantInput): Promise<VehicleResult> {
  const userId = await allow(actor);
  const current = UUID.test(id) ? await getMotorcycleVariant(db(), id) : null;
  if (!current) return { status: "not_found" };
  const parsed = variantInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: first(parsed.error.issues) };
  // A variant may move only between generations of the same model.
  const target = await getGeneration(db(), parsed.data.generationId);
  if (!target || target.modelId !== current.generation.modelId) return { status: "invalid", field: "invalid_generation" };
  return write(actor, userId, "motorcycle.variant_updated", "motorcycle_variant", async (tx) => {
    await updateMotorcycleVariantRow(tx, id, parsed.data);
    return id;
  }, parsed.data);
}
