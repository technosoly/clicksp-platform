import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import { categoryInputSchema, firstIssue, type CategoryData, type CategoryInput } from "../domain/catalog-input";
import {
  categoryWithDescendants,
  databaseMessage,
  getCategory,
  insertCategory,
  isUniqueViolation,
  listCategories as listCategoryRows,
  updateCategoryRow,
  type CategoryRow,
} from "../repo/catalog-repo";
import { adminId, allowedCategories, allows, IS_UUID } from "./catalog-access";

/**
 * Category tree management (category.manage). Store Staff hold it for their
 * categories only: they can add and edit categories below the ones they
 * cover, but not create top-level categories or move a category out of
 * their area. Categories are deactivated, never deleted.
 */

export type CatalogResult = { status: "ok"; id: string } | { status: "invalid"; field: string } | { status: "not_found" } | { status: "taken" };

export interface CategoryListItem extends CategoryRow {
  editable: boolean;
}

/** The tree for the category screen (scoped actors see their part of it). */
export async function listCategoriesForAdmin(actor: Actor): Promise<{ rows: CategoryListItem[]; canCreateRoot: boolean }> {
  const allowed = await allowedCategories(actor, "category.manage");
  const rows = await listCategoryRows(db());
  const visible = allowed === null ? rows : rows.filter((r) => allowed.includes(r.id));
  return {
    rows: visible.map((r) => ({ ...r, editable: allows(actor, "category.manage", [r.id]) })),
    canCreateRoot: allows(actor, "category.manage", undefined),
  };
}

/**
 * Categories a product may be filed under by this actor (product.create or
 * product.update), for pickers. Inactive categories are included so existing
 * products keep showing their category.
 */
export async function categoryOptions(actor: Actor, permission: "product.create" | "product.update" | "product.view"): Promise<CategoryRow[]> {
  const allowed = await allowedCategories(actor, permission);
  const rows = await listCategoryRows(db());
  return allowed === null ? rows : rows.filter((r) => allowed.includes(r.id));
}

export async function getCategoryForAdmin(actor: Actor, id: string) {
  if (!IS_UUID.test(id)) return null;
  await authorize(actor, "category.manage", { type: "category", id, categoryIds: [id] }, { stepUp: false });
  const category = await getCategory(db(), id);
  if (!category) return null;
  // Parents it may be moved under: anything the actor covers, except itself and its subtree.
  const subtree = new Set(await categoryWithDescendants(db(), id));
  const all = await listCategoryRows(db());
  const parents = all.filter((r) => !subtree.has(r.id) && allows(actor, "category.manage", [r.id]));
  return { category, parents, canMakeRoot: allows(actor, "category.manage", undefined) };
}

function failure(error: unknown): CatalogResult {
  if (isUniqueViolation(error)) return { status: "taken" };
  const message = databaseMessage(error);
  if (message.includes("own ancestor") || message.includes("too deep") || message.includes("categories_depth_range") || message.includes("own_parent")) return { status: "invalid", field: "invalid_parent" };
  if (message.includes("slug_format")) return { status: "invalid", field: "invalid_slug" };
  throw error;
}

async function authorizeParent(actor: Actor, parentId: string | null, categoryId?: string): Promise<void> {
  // A top-level category needs the permission for every category (unscoped).
  await authorize(actor, "category.manage", parentId ? { type: "category", id: categoryId, categoryIds: [parentId] } : { type: "category", id: categoryId });
}

export async function createCategory(actor: Actor, input: CategoryInput): Promise<CatalogResult> {
  const userId = adminId(actor, "category.manage");
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) {
    await allowedCategories(actor, "category.manage");
    return { status: "invalid", field: firstIssue(parsed.error) };
  }
  const data = parsed.data;
  if (data.parentId && !(await getCategory(db(), data.parentId))) return { status: "invalid", field: "invalid_parent" };
  await authorizeParent(actor, data.parentId);
  try {
    const id = await transaction(async (tx) => {
      const id = await insertCategory(tx, data);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "category.created", entityType: "category", entityId: id, after: summary(data) });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateCategory(actor: Actor, id: string, input: CategoryInput): Promise<CatalogResult> {
  const userId = adminId(actor, "category.manage");
  if (!IS_UUID.test(id)) return { status: "not_found" };
  await authorize(actor, "category.manage", { type: "category", id, categoryIds: [id] });
  const current = await getCategory(db(), id);
  if (!current) return { status: "not_found" };
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  const data = parsed.data;
  if (data.parentId !== current.parentId) {
    if (data.parentId === id) return { status: "invalid", field: "invalid_parent" };
    if (data.parentId && !(await getCategory(db(), data.parentId))) return { status: "invalid", field: "invalid_parent" };
    await authorizeParent(actor, data.parentId, id);
  }
  try {
    await transaction(async (tx) => {
      await updateCategoryRow(tx, id, data);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "category.updated",
        entityType: "category",
        entityId: id,
        before: {
          parentId: current.parentId,
          isActive: current.isActive,
          isVehicleSystem: current.isVehicleSystem,
          sortOrder: current.sortOrder,
          names: current.names,
        },
        after: summary(data),
      });
    });
    return { status: "ok", id };
  } catch (error) {
    return failure(error);
  }
}

function summary(data: CategoryData) {
  return {
    parentId: data.parentId,
    isActive: data.isActive,
    isVehicleSystem: data.isVehicleSystem,
    sortOrder: data.sortOrder,
    names: Object.fromEntries(data.names.map((n) => [n.locale, { name: n.name, slug: n.slug }])),
  };
}
