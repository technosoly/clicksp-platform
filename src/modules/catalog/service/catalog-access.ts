import "server-only";
import type { Actor } from "@/modules/rbac/domain/actor";
import { decide } from "@/modules/rbac/domain/authorize";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";

/**
 * Shared authorization helpers for the catalog services. Catalog permissions
 * can be held for a set of categories (Store Staff): such a grant covers a
 * category and everything below it, and a product only when every one of its
 * categories is covered.
 */

export const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in admin's id; anyone else is refused. */
export function adminId(actor: Actor, permission: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(permission, "not_admin");
  return actor.userId;
}

/**
 * For list screens: the categories the actor may see with `permission`
 * (null = all). An actor without the permission at all is denied (and the
 * denial recorded) by authorize().
 */
export async function allowedCategories(actor: Actor, permission: string): Promise<string[] | null> {
  adminId(actor, permission);
  const grant = actor.permissions.get(permission);
  if (!grant) {
    await authorize(actor, permission, undefined, { stepUp: false });
    return [];
  }
  return grant.unscoped ? null : [...grant.categoryIds];
}

/** Whether the actor could do `permission` on these categories (for showing controls). */
export function allows(actor: Actor, permission: string, categoryIds: readonly string[] | undefined): boolean {
  return decide(actor.permissions, permission, categoryIds ? { categoryIds } : undefined).allowed;
}
