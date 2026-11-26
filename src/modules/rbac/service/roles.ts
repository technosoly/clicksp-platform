import "server-only";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "../domain/actor";
import { canEditRoleLevel, canGrantPermission, diffGrants, type GrantChange } from "../domain/escalation";
import { SYSTEM_ROLES } from "../domain/permission-catalogue";
import {
  applyGrantDiff,
  getRoleWithGrants,
  insertRole,
  isRoleMember,
  listActivePermissions,
  listAdminRoles,
  roleKeyTaken,
  updateRoleDetails,
} from "../repo/roles-repo";
import { authorize, AuthzError } from "./authorize";

/**
 * Role and permission management (Super Admin, role.manage). Escalation
 * guards on top of the permission check:
 * - only roles of a strictly lower rank than the actor (levels 2-3 for a
 *   Super Admin) can be created or edited; the Super Admin bundle is fixed;
 * - the actor can grant or remove only permissions they hold themselves;
 * - nobody edits a role they are a member of;
 * - the database refuses permissions above a role's level ceiling.
 * Effective permissions are read fresh on every request, so a change applies
 * to members at their next click without signing them out.
 */

const IS_UUID = /^[0-9a-f-]{36}$/i;
const SYSTEM_KEYS = new Set(SYSTEM_ROLES.map((r) => r.key));

function actorLevel(actor: Actor): number {
  if (actor.kind !== "admin" || !actor.userId || actor.level === null) throw new AuthzError("role.manage", "not_admin");
  return actor.level;
}

export async function listRoles(actor: Actor) {
  await authorize(actor, "role.manage", undefined, { stepUp: false });
  return listAdminRoles(db());
}

export interface PermissionCell {
  key: string;
  module: string;
  scopeType: "category" | "warehouse" | null;
  requiresMfa: boolean;
  granted: boolean;
  scoped: boolean;
  /** Above this role's level ceiling: can never be granted to it. */
  allowedForLevel: boolean;
  /** The actor may change this cell. */
  editable: boolean;
}

export async function getRoleDetail(actor: Actor, roleId: string) {
  await authorize(actor, "role.manage", { type: "role", id: roleId }, { stepUp: false });
  const level = actorLevel(actor);
  if (!IS_UUID.test(roleId)) return null;
  const [role, permissions] = await Promise.all([getRoleWithGrants(db(), roleId), listActivePermissions(db())]);
  if (!role || role.level < 1 || role.level > 3) return null;
  const member = await isRoleMember(db(), actor.userId!, role.id);
  const roleEditable = canEditRoleLevel(level, role.level) && !member;
  const grants = new Map(role.permissions.map((g) => [g.permission.key, g.isScoped]));
  const cells: PermissionCell[] = permissions.map((p) => {
    const allowedForLevel = role.level <= p.maxLevel;
    return {
      key: p.key,
      module: p.module,
      scopeType: p.scopeType,
      requiresMfa: p.requiresMfa,
      granted: grants.has(p.key),
      scoped: grants.get(p.key) === true,
      allowedForLevel,
      editable: roleEditable && allowedForLevel && canGrantPermission(actor.permissions, p.key),
    };
  });
  return {
    role: { id: role.id, key: role.key, name: role.name, description: role.description, level: role.level, isSystem: role.isSystem, isActive: role.isActive },
    editable: roleEditable,
    isMember: member,
    cells,
  };
}

const roleDetailsSchema = z.object({
  name: z
    .string()
    .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "invalid_name").max(100, "invalid_name")),
  description: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(500, "invalid_description"))
    .transform((v) => (v === "" ? null : v)),
});

const createRoleSchema = roleDetailsSchema.extend({
  key: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, "invalid_key")),
  level: z.coerce.number().int().min(2, "invalid_level").max(3, "invalid_level"),
});

export type RoleChangeResult =
  | { status: "ok"; roleId: string }
  | { status: "invalid"; field: string }
  | { status: "not_found" }
  | { status: "taken" }
  | { status: "not_editable" };

export async function createRole(
  actor: Actor,
  input: { key: string; name: string; description: string; level: string | number },
): Promise<RoleChangeResult> {
  await authorize(actor, "role.manage", { type: "role" });
  const level = actorLevel(actor);
  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const data = parsed.data;
  if (!canEditRoleLevel(level, data.level)) return { status: "not_editable" };
  if (SYSTEM_KEYS.has(data.key as never) || (await roleKeyTaken(db(), data.key))) return { status: "taken" };
  const roleId = await transaction(async (tx) => {
    const id = await insertRole(tx, data);
    await recordAudit(tx, actor.meta, { actorUserId: actor.userId, action: "role.created", entityType: "role", entityId: id, after: data });
    return id;
  });
  return { status: "ok", roleId };
}

async function loadEditableRole(actor: Actor, roleId: string) {
  const level = actorLevel(actor);
  if (!IS_UUID.test(roleId)) return { status: "not_found" as const };
  const role = await getRoleWithGrants(db(), roleId);
  if (!role || role.level < 1 || role.level > 3) return { status: "not_found" as const };
  if (!canEditRoleLevel(level, role.level) || (await isRoleMember(db(), actor.userId!, role.id))) return { status: "not_editable" as const };
  return { status: "ok" as const, role };
}

export async function updateRole(
  actor: Actor,
  roleId: string,
  input: { name: string; description: string; isActive: boolean },
): Promise<RoleChangeResult> {
  await authorize(actor, "role.manage", { type: "role", id: roleId });
  const loaded = await loadEditableRole(actor, roleId);
  if (loaded.status !== "ok") return loaded;
  const parsed = roleDetailsSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  // System roles stay active: switching one off would silently lock its members out.
  const isActive = loaded.role.isSystem ? true : input.isActive;
  const before = { name: loaded.role.name, description: loaded.role.description, isActive: loaded.role.isActive };
  const after = { ...parsed.data, isActive };
  await transaction(async (tx) => {
    await updateRoleDetails(tx, roleId, after);
    await recordAudit(tx, actor.meta, { actorUserId: actor.userId, action: "role.updated", entityType: "role", entityId: roleId, before, after });
  });
  return { status: "ok", roleId };
}

/**
 * Sets a role's permissions from the editor. Cells the actor may not change
 * (permissions they don't hold, above the role's ceiling) keep their current
 * state whatever the form sends, so a hand-crafted request can't grant them.
 */
export async function setRolePermissions(actor: Actor, roleId: string, requested: readonly GrantChange[]): Promise<RoleChangeResult> {
  await authorize(actor, "role.manage", { type: "role", id: roleId });
  const loaded = await loadEditableRole(actor, roleId);
  if (loaded.status !== "ok") return loaded;
  const role = loaded.role;
  const permissions = await listActivePermissions(db());
  const known = new Map(permissions.map((p) => [p.key, p]));
  const wanted = new Map<string, boolean>();
  for (const g of requested) {
    if (!known.has(g.key)) return { status: "invalid", field: "unknown_permission" };
    wanted.set(g.key, g.isScoped);
  }

  const current: GrantChange[] = role.permissions.map((g) => ({ key: g.permission.key, isScoped: g.isScoped }));
  const currentMap = new Map(current.map((g) => [g.key, g.isScoped]));
  const next: GrantChange[] = [];
  for (const p of permissions) {
    const changeable = role.level <= p.maxLevel && canGrantPermission(actor.permissions, p.key);
    if (!changeable) {
      if (currentMap.has(p.key)) next.push({ key: p.key, isScoped: currentMap.get(p.key)! });
      continue;
    }
    if (wanted.has(p.key)) next.push({ key: p.key, isScoped: p.scopeType !== null && wanted.get(p.key) === true });
  }
  // Grants of permissions that are no longer active are left untouched.
  for (const g of current) if (!known.has(g.key)) next.push(g);

  const diff = diffGrants(current, next);
  if (diff.added.length + diff.removed.length + diff.rescoped.length === 0) return { status: "ok", roleId };
  await transaction(async (tx) => {
    await applyGrantDiff(tx, roleId, diff, actor.userId!);
    await recordAudit(tx, actor.meta, {
      actorUserId: actor.userId,
      action: "role.permissions_changed",
      entityType: "role",
      entityId: roleId,
      after: { role: role.key, added: diff.added, removed: diff.removed, rescoped: diff.rescoped },
    });
  });
  return { status: "ok", roleId };
}
