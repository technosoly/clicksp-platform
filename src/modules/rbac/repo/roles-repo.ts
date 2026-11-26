/**
 * Database access for the role and permission screens (Phase 5).
 */
import type { DbClient } from "@/lib/db";
import type { GrantDiff } from "../domain/escalation";

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  memberCount: number;
  permissionCount: number;
}

/** Admin roles (levels 1-3) with member and permission counts. */
export async function listAdminRoles(client: DbClient): Promise<RoleSummary[]> {
  const rows = await client.$queryRaw<
    { id: string; key: string; name: string; description: string | null; level: number; is_system: boolean; is_active: boolean; members: number; perms: number }[]
  >`
    SELECT r.id, r.key, r.name, r.description, r.level, r.is_system, r.is_active,
           (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS members,
           (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS perms
      FROM roles r
     WHERE r.level BETWEEN 1 AND 3
     ORDER BY r.level, r.is_system DESC, r.name`;
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    level: Number(r.level),
    isSystem: r.is_system,
    isActive: r.is_active,
    memberCount: r.members,
    permissionCount: r.perms,
  }));
}

export async function getRoleWithGrants(client: DbClient, roleId: string) {
  return client.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      level: true,
      isSystem: true,
      isActive: true,
      permissions: { select: { isScoped: true, permission: { select: { key: true } } } },
    },
  });
}

export async function listActivePermissions(client: DbClient) {
  return client.permission.findMany({
    where: { isActive: true },
    select: { id: true, key: true, module: true, scopeType: true, requiresMfa: true, maxLevel: true },
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });
}

export async function roleKeyTaken(client: DbClient, key: string): Promise<boolean> {
  return (await client.role.findUnique({ where: { key }, select: { id: true } })) !== null;
}

export async function insertRole(client: DbClient, data: { key: string; name: string; description: string | null; level: number }): Promise<string> {
  const role = await client.role.create({ data: { ...data, isSystem: false, isActive: true }, select: { id: true } });
  return role.id;
}

export async function updateRoleDetails(
  client: DbClient,
  roleId: string,
  data: { name: string; description: string | null; isActive: boolean },
): Promise<void> {
  await client.role.update({ where: { id: roleId }, data });
}

/** Applies added, removed and re-scoped grants of one role. */
export async function applyGrantDiff(client: DbClient, roleId: string, diff: GrantDiff, grantedById: string): Promise<void> {
  const keys = [...diff.added.map((g) => g.key), ...diff.rescoped.map((g) => g.key), ...diff.removed];
  if (keys.length === 0) return;
  const perms = await client.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  const idOf = new Map(perms.map((p) => [p.key, p.id]));
  const id = (key: string): string => {
    const value = idOf.get(key);
    if (!value) throw new Error(`unknown permission ${key}`);
    return value;
  };
  if (diff.removed.length > 0) {
    await client.rolePermission.deleteMany({ where: { roleId, permissionId: { in: diff.removed.map(id) } } });
  }
  for (const grant of diff.rescoped) {
    await client.rolePermission.update({
      where: { roleId_permissionId: { roleId, permissionId: id(grant.key) } },
      data: { isScoped: grant.isScoped, grantedById },
    });
  }
  if (diff.added.length > 0) {
    await client.rolePermission.createMany({
      data: diff.added.map((g) => ({ roleId, permissionId: id(g.key), isScoped: g.isScoped, grantedById })),
    });
  }
}

export async function isRoleMember(client: DbClient, userId: string, roleId: string): Promise<boolean> {
  return (await client.userRole.findUnique({ where: { userId_roleId: { userId, roleId } }, select: { id: true } })) !== null;
}
