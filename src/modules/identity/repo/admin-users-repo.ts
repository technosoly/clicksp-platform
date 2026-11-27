/**
 * Database access for managing admin accounts (Phase 5): listing, creating,
 * role changes, status, password links, password hashes, MFA reset and
 * sessions. Every function takes a client so services can run it inside a
 * transaction.
 */
import type { DbClient } from "@/lib/db";
import type { PasswordLinkPurpose } from "../domain/admin-account";
import type { SessionKind } from "../domain/policy";

export interface AdminUserRow {
  id: string;
  username: string | null;
  name: string;
  email: string | null;
  status: "active" | "pending_verification" | "locked" | "disabled";
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  role: { id: string; key: string; name: string; level: number; isSystem: boolean };
}

interface RawAdminUser {
  id: string;
  username: string | null;
  name: string;
  email: string | null;
  status: AdminUserRow["status"];
  two_factor_enabled: boolean;
  has_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  role_id: string;
  role_key: string;
  role_name: string;
  role_level: number;
  role_is_system: boolean;
}

const toRow = (r: RawAdminUser): AdminUserRow => ({
  id: r.id,
  username: r.username,
  name: r.name,
  email: r.email,
  status: r.status,
  twoFactorEnabled: r.two_factor_enabled,
  hasPassword: r.has_password,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
  role: { id: r.role_id, key: r.role_key, name: r.role_name, level: Number(r.role_level), isSystem: r.role_is_system },
});

/**
 * Admin accounts whose highest admin role (lowest level number, of any
 * assignment, active or not) is one of `levels`. A user is listed once, with
 * that role. Customers never appear.
 */
export async function listAdminUsers(client: DbClient, levels: number[]): Promise<AdminUserRow[]> {
  if (levels.length === 0) return [];
  const rows = await client.$queryRaw<RawAdminUser[]>`
    SELECT u.id, u.username, u.name, u.email, u.status::text AS status, u.two_factor_enabled,
           EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential'
                    AND a.password_hash IS NOT NULL) AS has_password,
           u.last_login_at, u.created_at,
           r.id AS role_id, r.key AS role_key, r.name AS role_name, r.level AS role_level, r.is_system AS role_is_system
      FROM users u
      JOIN LATERAL (
        SELECT r.* FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.level BETWEEN 1 AND 3
         ORDER BY r.level, r.key LIMIT 1) r ON true
     WHERE r.level = ANY(${levels}::int[])
     ORDER BY r.level, u.username NULLS LAST, u.created_at
     LIMIT 500`;
  return rows.map(toRow);
}

export async function getAdminUser(client: DbClient, userId: string): Promise<AdminUserRow | null> {
  const rows = await client.$queryRaw<RawAdminUser[]>`
    SELECT u.id, u.username, u.name, u.email, u.status::text AS status, u.two_factor_enabled,
           EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential'
                    AND a.password_hash IS NOT NULL) AS has_password,
           u.last_login_at, u.created_at,
           r.id AS role_id, r.key AS role_key, r.name AS role_name, r.level AS role_level, r.is_system AS role_is_system
      FROM users u
      JOIN LATERAL (
        SELECT r.* FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.level BETWEEN 1 AND 3
         ORDER BY r.level, r.key LIMIT 1) r ON true
     WHERE u.id = ${userId}::uuid`;
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Highest admin level (lowest number) among ALL of the user's admin role
 * assignments, including expired ones and inactive roles: who may manage an
 * account is decided by the most privileged role it has ever been given.
 */
export async function strongestAdminLevel(client: DbClient, userId: string): Promise<number | null> {
  const rows = await client.$queryRaw<{ level: number | null }[]>`
    SELECT min(r.level)::int AS level FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ${userId}::uuid AND r.level BETWEEN 1 AND 3`;
  return rows[0]?.level ?? null;
}

/** Whether the user holds a role of level 0 only (a customer) or nothing at all. */
export async function isCustomerAccount(client: DbClient, userId: string): Promise<boolean> {
  return (await strongestAdminLevel(client, userId)) === null;
}

export async function findRole(client: DbClient, roleId: string) {
  return client.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, name: true, level: true, isSystem: true, isActive: true },
  });
}

/** The permission grants of a role (to check the assigner holds them all). */
export async function listRoleGrants(client: DbClient, roleId: string): Promise<{ key: string; isScoped: boolean }[]> {
  const rows = await client.rolePermission.findMany({
    where: { roleId },
    select: { isScoped: true, permission: { select: { key: true } } },
  });
  return rows.map((r) => ({ key: r.permission.key, isScoped: r.isScoped }));
}

/** Every permission grant of all the user's admin roles (levels 1-3, any state). */
export async function listUserAdminGrants(client: DbClient, userId: string): Promise<{ key: string; isScoped: boolean }[]> {
  const rows = await client.rolePermission.findMany({
    where: { role: { level: { gte: 1, lte: 3 }, userRoles: { some: { userId } } } },
    select: { isScoped: true, permission: { select: { key: true } } },
  });
  return rows.map((r) => ({ key: r.permission.key, isScoped: r.isScoped }));
}

/** Active admin roles of the given levels (for the role picker). */
export async function listAssignableRoles(client: DbClient, levels: number[]) {
  return client.role.findMany({
    where: { isActive: true, level: { in: levels } },
    select: { id: true, key: true, name: true, level: true, isSystem: true },
    orderBy: [{ level: "asc" }, { isSystem: "desc" }, { name: "asc" }],
  });
}

export async function identifierTaken(
  client: DbClient,
  input: { username?: string; email?: string | null; exceptUserId?: string },
): Promise<"username" | "email" | null> {
  if (input.username) {
    const u = await client.user.findFirst({ where: { username: input.username, NOT: input.exceptUserId ? { id: input.exceptUserId } : undefined }, select: { id: true } });
    if (u) return "username";
  }
  if (input.email) {
    const e = await client.user.findFirst({ where: { email: input.email, NOT: input.exceptUserId ? { id: input.exceptUserId } : undefined }, select: { id: true } });
    if (e) return "email";
  }
  return null;
}

/** A new admin account without a password; the "set your password" link completes it. */
export async function insertAdminUser(
  client: DbClient,
  input: { username: string; email: string | null; name: string; roleId: string; assignedById: string },
): Promise<string> {
  const user = await client.user.create({
    data: { username: input.username, email: input.email, name: input.name, status: "active" },
    select: { id: true },
  });
  await client.userProfile.create({ data: { userId: user.id } });
  await client.userRole.create({ data: { userId: user.id, roleId: input.roleId, assignedById: input.assignedById } });
  return user.id;
}

export async function updateAdminUserDetails(client: DbClient, userId: string, data: { name: string; email: string | null }) {
  await client.user.update({ where: { id: userId }, data });
}

/**
 * Gives the user exactly one admin role: adds the new one first, then removes
 * every other admin role (levels 1-3), so the last-Super-Admin trigger sees
 * the final state. Their scope rows go with the removed assignments.
 */
export async function replaceAdminRole(client: DbClient, userId: string, roleId: string, assignedById: string): Promise<void> {
  await client.$executeRaw`
    INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (${userId}::uuid, ${roleId}::uuid, ${assignedById}::uuid)
    ON CONFLICT (user_id, role_id) DO UPDATE SET expires_at = NULL, assigned_by = EXCLUDED.assigned_by`;
  await client.$executeRaw`
    DELETE FROM user_roles ur USING roles r
     WHERE ur.role_id = r.id AND ur.user_id = ${userId}::uuid AND r.level BETWEEN 1 AND 3 AND ur.role_id <> ${roleId}::uuid`;
}

export async function setUserStatus(client: DbClient, userId: string, status: "active" | "disabled"): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { status } });
}

// ---------- password links ----------

/** Stores a new link (hash only) and retires every earlier unused link of the user. */
export async function createPasswordLink(
  client: DbClient,
  row: { purpose: PasswordLinkPurpose; userId: string; identifier: string; valueHash: string; expiresAt: Date; now: Date },
): Promise<string> {
  await client.verificationToken.updateMany({
    where: { userId: row.userId, purpose: { in: ["admin_invite", "password_reset"] }, consumedAt: null },
    data: { consumedAt: row.now },
  });
  const token = await client.verificationToken.create({
    data: {
      purpose: row.purpose,
      identifier: row.identifier,
      userId: row.userId,
      valueHash: row.valueHash,
      expiresAt: row.expiresAt,
      createdAt: row.now,
    },
    select: { id: true },
  });
  return token.id;
}

/**
 * Retires every unused password link of the user. Called whenever the
 * account's privileges or status change, so a link handed out for a Store
 * Staff account can never be used after a promotion or a disable.
 */
export async function retirePasswordLinks(client: DbClient, userId: string, at: Date): Promise<number> {
  const result = await client.verificationToken.updateMany({
    where: { userId, purpose: { in: ["admin_invite", "password_reset"] }, consumedAt: null },
    data: { consumedAt: at },
  });
  return result.count;
}

export async function findPasswordLink(client: DbClient, valueHash: string) {
  const token = await client.verificationToken.findUnique({
    where: { valueHash },
    select: { id: true, purpose: true, userId: true, expiresAt: true, consumedAt: true },
  });
  if (!token || (token.purpose !== "admin_invite" && token.purpose !== "password_reset") || !token.userId) return null;
  return { ...token, purpose: token.purpose as PasswordLinkPurpose, userId: token.userId };
}

/** Marks the link used; false when another request used it first. */
export async function consumePasswordLink(client: DbClient, tokenId: string, at: Date): Promise<boolean> {
  const result = await client.verificationToken.updateMany({
    where: { id: tokenId, consumedAt: null, expiresAt: { gt: at } },
    data: { consumedAt: at },
  });
  return result.count === 1;
}

// ---------- passwords ----------

export async function getPasswordHash(client: DbClient, userId: string): Promise<string | null> {
  const account = await client.authAccount.findFirst({
    where: { userId, providerId: "credential" },
    select: { passwordHash: true },
  });
  return account?.passwordHash ?? null;
}

/** Sets (or creates) the user's password credential. */
export async function setPasswordHash(client: DbClient, userId: string, passwordHash: string, at: Date): Promise<void> {
  await client.authAccount.upsert({
    where: { providerId_accountId: { providerId: "credential", accountId: userId } },
    create: { userId, providerId: "credential", accountId: userId, passwordHash, passwordChangedAt: at },
    update: { passwordHash, passwordChangedAt: at },
  });
}

// ---------- MFA ----------

/** Removes the TOTP enrolment and backup codes; the user enrols again at next sign-in. */
export async function deleteMfa(client: DbClient, userId: string): Promise<boolean> {
  const result = await client.userMfa.deleteMany({ where: { userId } });
  await client.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
  return result.count > 0;
}

// ---------- sessions ----------

export async function listActiveSessions(client: DbClient, userId: string, kind: SessionKind, now: Date) {
  return client.session.findMany({
    where: { userId, kind, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaVerifiedAt: true, expiresAt: true },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });
}

/** Revokes one session of the given user (never another user's); false if none matched. */
export async function revokeSessionOf(client: DbClient, userId: string, sessionId: string, reason: string, at: Date): Promise<boolean> {
  const result = await client.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: at, revokedReason: reason },
  });
  return result.count === 1;
}

/** Revokes every session of the user except one (the current browser). */
export async function revokeOtherSessions(client: DbClient, userId: string, keepSessionId: string, reason: string, at: Date): Promise<number> {
  const result = await client.session.updateMany({
    where: { userId, revokedAt: null, NOT: { id: keepSessionId } },
    data: { revokedAt: at, revokedReason: reason },
  });
  return result.count;
}

// ---------- scopes ----------

/**
 * The account's role assignments whose role grants category-scoped
 * permissions, with those permission keys and the current category scope.
 */
export type ScopeKind = "category" | "warehouse";

/** The account's role assignments holding permissions scoped by `kind`, with their current scope ids. */
export async function listScopedAssignments(client: DbClient, userId: string, kind: ScopeKind) {
  const rows = await client.userRole.findMany({
    where: { userId, role: { level: { gte: 1, lte: 3 }, permissions: { some: { isScoped: true, permission: { scopeType: kind } } } } },
    select: {
      id: true,
      role: {
        select: {
          key: true,
          name: true,
          permissions: { where: { isScoped: true, permission: { scopeType: kind } }, select: { permission: { select: { key: true } } } },
        },
      },
      scopes: { where: { scopeType: kind }, select: { categoryId: true, warehouseId: true } },
    },
  });
  return rows.map((r) => ({
    userRoleId: r.id,
    role: { key: r.role.key, name: r.role.name },
    scopedKeys: r.role.permissions.map((p) => p.permission.key),
    ids: r.scopes.map((s) => (kind === "category" ? s.categoryId : s.warehouseId)).filter((v): v is string => v !== null),
  }));
}

export async function listCategoryScopedAssignments(client: DbClient, userId: string) {
  return (await listScopedAssignments(client, userId, "category")).map(({ ids, ...rest }) => ({ ...rest, categoryIds: ids }));
}

/** Replaces the category or warehouse scope of one role assignment. */
export async function replaceScopes(client: DbClient, userRoleId: string, kind: ScopeKind, ids: string[]): Promise<void> {
  const column = kind === "category" ? "categoryId" : "warehouseId";
  await client.userRoleScope.deleteMany({ where: { userRoleId, scopeType: kind, [column]: { notIn: ids } } });
  const existing = new Set(
    (await client.userRoleScope.findMany({ where: { userRoleId, scopeType: kind }, select: { categoryId: true, warehouseId: true } })).map((s) =>
      kind === "category" ? s.categoryId : s.warehouseId,
    ),
  );
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    await client.userRoleScope.createMany({ data: missing.map((id) => ({ userRoleId, scopeType: kind, [column]: id })) });
  }
}

export async function replaceCategoryScopes(client: DbClient, userRoleId: string, categoryIds: string[]): Promise<void> {
  await replaceScopes(client, userRoleId, "category", categoryIds);
}

export async function existingCategoryIds(client: DbClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await client.category.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  return rows.map((r) => r.id);
}
