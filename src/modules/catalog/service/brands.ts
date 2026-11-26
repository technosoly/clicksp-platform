import "server-only";
import { imageRenditions } from "@/modules/media/service/images";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import { brandInputSchema, firstIssue, type BrandData, type BrandInput } from "../domain/catalog-input";
import { databaseMessage, getBrand, insertBrand, isUniqueViolation, listBrands, updateBrandRow } from "../repo/catalog-repo";
import { adminId, allows, IS_UUID } from "./catalog-access";
import type { CatalogResult } from "./categories";

/** Brands (brand.manage, held by every admin level by default). Deactivated, never deleted. */

export async function listBrandsForAdmin(actor: Actor) {
  adminId(actor, "brand.manage");
  await authorize(actor, "brand.manage", undefined, { stepUp: false });
  return listBrands(db());
}

/** Brands for product pickers: anyone who may view products may pick one. */
export async function brandOptions(actor: Actor) {
  adminId(actor, "product.view");
  if (!actor.permissions.has("product.view")) await authorize(actor, "product.view", undefined, { stepUp: false });
  return listBrands(db());
}

export async function getBrandForAdmin(actor: Actor, id: string) {
  if (!IS_UUID.test(id)) return null;
  await authorize(actor, "brand.manage", { type: "brand", id }, { stepUp: false });
  const brand = await getBrand(db(), id);
  if (!brand) return null;
  return {
    ...brand,
    logo: brand.logoMediaId ? await imageRenditions(brand.logoMediaId) : [],
    // A brand has no category, so only unscoped uploaders can set its logo.
    canSetLogo: allows(actor, "media.upload", undefined),
  };
}

function failure(error: unknown): CatalogResult {
  if (isUniqueViolation(error)) return { status: "taken" };
  if (databaseMessage(error).includes("slug_format")) return { status: "invalid", field: "invalid_slug" };
  throw error;
}

const summary = (data: BrandData) => ({
  isGenuine: data.isGenuine,
  isActive: data.isActive,
  sortOrder: data.sortOrder,
  names: Object.fromEntries(data.names.map((n) => [n.locale, { name: n.name, slug: n.slug }])),
});

export async function createBrand(actor: Actor, input: BrandInput): Promise<CatalogResult> {
  const userId = adminId(actor, "brand.manage");
  await authorize(actor, "brand.manage", { type: "brand" });
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  try {
    const id = await transaction(async (tx) => {
      const id = await insertBrand(tx, parsed.data);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "brand.created", entityType: "brand", entityId: id, after: summary(parsed.data) });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateBrand(actor: Actor, id: string, input: BrandInput): Promise<CatalogResult> {
  const userId = adminId(actor, "brand.manage");
  if (!IS_UUID.test(id)) return { status: "not_found" };
  await authorize(actor, "brand.manage", { type: "brand", id });
  const current = await getBrand(db(), id);
  if (!current) return { status: "not_found" };
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  try {
    await transaction(async (tx) => {
      await updateBrandRow(tx, id, parsed.data);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "brand.updated",
        entityType: "brand",
        entityId: id,
        before: { isGenuine: current.isGenuine, isActive: current.isActive, sortOrder: current.sortOrder, names: current.names },
        after: summary(parsed.data),
      });
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}
