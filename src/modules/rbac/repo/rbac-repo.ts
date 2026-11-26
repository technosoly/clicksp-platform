import type { DbClient } from "@/lib/db";
import type { GrantRow } from "../domain/authorize";

/**
 * Every permission grant the user holds now, through active roles whose
 * assignment has not expired, with the scope rows of that user-role.
 * Inactive permissions are left out.
 */
export async function loadGrantRows(client: DbClient, userId: string, now: Date): Promise<GrantRow[]> {
  const rows = await client.$queryRaw<
    {
      key: string;
      is_scoped: boolean;
      requires_mfa: boolean;
      scope_type: "category" | "warehouse" | null;
      category_ids: string[] | null;
      warehouse_ids: string[] | null;
    }[]
  >`
    SELECT p.key, rp.is_scoped, p.requires_mfa, p.scope_type::text AS scope_type,
           array_remove(array_agg(DISTINCT s.category_id::text), NULL) AS category_ids,
           array_remove(array_agg(DISTINCT s.warehouse_id::text), NULL) AS warehouse_ids
      FROM user_roles ur
      JOIN roles r             ON r.id = ur.role_id AND r.is_active
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p       ON p.id = rp.permission_id AND p.is_active
      LEFT JOIN user_role_scopes s ON s.user_role_id = ur.id
     WHERE ur.user_id = ${userId}::uuid
       AND (ur.expires_at IS NULL OR ur.expires_at > ${now})
     GROUP BY ur.id, p.key, rp.is_scoped, p.requires_mfa, p.scope_type`;
  return rows.map((r) => ({
    key: r.key,
    isScoped: r.is_scoped,
    requiresMfa: r.requires_mfa,
    scopeType: r.scope_type,
    categoryIds: r.category_ids ?? [],
    warehouseIds: r.warehouse_ids ?? [],
  }));
}

export async function primaryRole(client: DbClient, userId: string, now: Date) {
  const row = await client.userRole.findFirst({
    where: {
      userId,
      role: { isActive: true, level: { gte: 1, lte: 3 } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { role: { level: "asc" } },
    select: { role: { select: { key: true, name: true, level: true, isSystem: true } } },
  });
  return row?.role ?? null;
}
