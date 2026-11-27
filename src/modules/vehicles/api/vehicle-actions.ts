"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import {
  createGeneration,
  createManufacturer,
  createModel,
  createMotorcycleBrand,
  createMotorcycleVariant,
  updateGeneration,
  updateManufacturer,
  updateModel,
  updateMotorcycleBrand,
  updateMotorcycleVariant,
  type VehicleResult,
} from "../service/motorcycles";

/** Server Actions for the motorcycle screens; the services authorize every call. */

function state(result: VehicleResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  if (result.status === "invalid") return { error: result.field };
  if (result.status === "taken") return { error: "slug_taken" };
  return { error: result.status };
}

const names = (form: FormData) => ({ faName: text(form, "faName"), faSlug: text(form, "faSlug"), enName: text(form, "enName"), enSlug: text(form, "enSlug") });
const checked = (form: FormData, key: string) => form.get(key) === "on";

export async function createManufacturerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(await createManufacturer(actor, { ...names(form), countryCode: text(form, "countryCode"), isActive: true, sortOrder: text(form, "sortOrder") }), "created"),
  );
}

export async function updateManufacturerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await updateManufacturer(actor, text(form, "manufacturerId"), {
        ...names(form),
        countryCode: text(form, "countryCode"),
        isActive: checked(form, "isActive"),
        sortOrder: text(form, "sortOrder"),
      }),
      "saved",
    ),
  );
}

export async function createMotorcycleBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(await createMotorcycleBrand(actor, { ...names(form), manufacturerId: text(form, "manufacturerId"), isActive: true, sortOrder: text(form, "sortOrder") }), "created"),
  );
}

export async function updateMotorcycleBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await updateMotorcycleBrand(actor, text(form, "brandId"), {
        ...names(form),
        manufacturerId: text(form, "manufacturerId"),
        isActive: checked(form, "isActive"),
        sortOrder: text(form, "sortOrder"),
      }),
      "saved",
    ),
  );
}

const modelFields = (form: FormData, isActive: boolean) => ({
  ...names(form),
  brandId: text(form, "brandId"),
  segment: text(form, "segment"),
  isActive,
  sortOrder: text(form, "sortOrder"),
});

export async function createModelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createModel(actor, modelFields(form, true)), "created"));
}

export async function updateModelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateModel(actor, text(form, "modelId"), modelFields(form, checked(form, "isActive"))), "saved"));
}

const generationFields = (form: FormData) => ({ code: text(form, "code"), yearFrom: text(form, "yearFrom"), yearTo: text(form, "yearTo") });

export async function createGenerationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createGeneration(actor, text(form, "modelId"), generationFields(form)), "created"));
}

export async function updateGenerationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateGeneration(actor, text(form, "generationId"), generationFields(form)), "saved"));
}

const variantFields = (form: FormData, isActive: boolean) => ({
  generationId: text(form, "generationId"),
  faName: text(form, "faName"),
  enName: text(form, "enName"),
  code: text(form, "code"),
  engineDisplacementCc: text(form, "engineDisplacementCc"),
  engineStroke: text(form, "engineStroke"),
  cylinders: text(form, "cylinders"),
  cooling: text(form, "cooling"),
  fuelSystem: text(form, "fuelSystem"),
  marketCode: text(form, "marketCode"),
  yearFrom: text(form, "yearFrom"),
  yearTo: text(form, "yearTo"),
  isActive,
});

export async function createMotorcycleVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createMotorcycleVariant(actor, variantFields(form, true)), "created"));
}

export async function updateMotorcycleVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await updateMotorcycleVariant(actor, text(form, "variantId"), variantFields(form, checked(form, "isActive"))), "saved"));
}
