import "server-only";
import { db, transaction } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/security/tokens";
import { recordAudit, recordSecurityEvent } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { manageableLevels, userManagementPermission, type ManagingActor } from "@/modules/rbac/domain/escalation";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import {
  accountAuditAction,
  createAdminUserSchema,
  firstIssue,
  passwordLinkExpiry,
  updateAdminUserSchema,
  type CreateAdminUserInput,
  type PasswordLinkPurpose,
  type UpdateAdminUserInput,
} from "../domain/admin-account";
import {
  createPasswordLink,
  deleteMfa,
  findRole,
  getAdminUser,
  identifierTaken,
  insertAdminUser,
  listActiveSessions,
  listAdminUsers as listAdminUserRows,
  listAssignableRoles,
  replaceAdminRole,
  setUserStatus,
  strongestAdminLevel,
  updateAdminUserDetails,
  type AdminUserRow,
} from "../repo/admin-users-repo";
import { revokeUserSessions } from "../repo/identity-repo";

/**
 * Managing other admin accounts (Phase 5): Super Admins manage every admin,
 * Business Admins manage Store Staff accounts only. Every method authorizes
 * against the target account's level (escalation guards in
 * rbac/domain/escalation.ts) and writes an audit row in the same transaction
 * as the change. Nobody manages their own account here (see account.ts).
 */

export type ManageError =
  | { status: "invalid"; field: string }
  | { status: "not_found" }
  | { status: "self" }
  | { status: "taken"; field: "username" | "email" }
  | { status: "last_super_admin" };

function managingActor(actor: Actor): ManagingActor {
  if (actor.kind !== "admin" || !actor.userId || actor.level === null) throw new AuthzError("user.manage_staff", "not_admin");
  return { userId: actor.userId, level: actor.level, permissions: actor.permissions };
}

/**
 * Authorizes managing an account of `targetLevel`. Levels the actor can never
 * manage are denied (and recorded) before the permission check.
 */
async function authorizeTargetLevel(actor: Actor, targetLevel: number, targetId: string | undefined, stepUp: boolean): Promise<ManagingActor> {
  const managing = managingActor(actor);
  const permission = userManagementPermission(managing, targetLevel);
  if (!permission) {
    const denied = targetLevel === 3 ? "user.manage_staff" : "user.manage_admins";
    await recordSecurityEvent(actor.meta, {
      type: "authz.denied",
      severity: "warning",
      userId: actor.userId,
      details: { permission: denied, reason: "target_level", targetLevel, resourceType: "user", resourceId: targetId },
    });
    throw new AuthzError(denied, "target_level");
  }
  await authorize(actor, permission, { type: "user", id: targetId }, { stepUp });
  return managing;
}

/** Loads a target account and authorizes managing it (by its strongest admin role). */
async function loadTarget(actor: Actor, userId: string, stepUp: boolean): Promise<{ row: AdminUserRow; level: number } | ManageError> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { status: "not_found" };
  const [row, level] = await Promise.all([getAdminUser(db(), userId), strongestAdminLevel(db(), userId)]);
  if (!row || level === null) return { status: "not_found" };
  await authorizeTargetLevel(actor, level, userId, stepUp);
  return { row, level };
}

function isLastSuperAdminError(error: unknown): boolean {
  return String(error).includes("last active Super Admin");
}

function newPasswordLink(): { token: string; hash: string } {
  const token = randomToken(32);
  return { token, hash: sha256Hex(token) };
}

// ---------------------------------------------------------------------------
// Reads (no step-up TOTP check; changes below need one)
// ---------------------------------------------------------------------------

export async function listManagedAdmins(actor: Actor): Promise<AdminUserRow[]> {
  const managing = managingActor(actor);
  const levels = manageableLevels(managing);
  if (levels.length === 0) {
    await authorize(actor, "user.manage_staff", undefined, { stepUp: false });
    return [];
  }
  // Authorize the most privileged level listed (the others need no more).
  await authorizeTargetLevel(actor, Math.min(...levels), undefined, false);
  return listAdminUserRows(db(), levels);
}

/** Roles the actor may give to an account (active roles of manageable levels). */
export async function assignableRoles(actor: Actor) {
  const levels = manageableLevels(managingActor(actor));
  if (levels.length === 0) return [];
  return listAssignableRoles(db(), levels);
}

export async function getManagedAdmin(actor: Actor, userId: string) {
  const target = await loadTarget(actor, userId, false);
  if ("status" in target) return target;
  const sessions = await listActiveSessions(db(), userId, "admin", new Date());
  return { status: "ok" as const, user: target.row, level: target.level, isSelf: userId === actor.userId, sessions };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export type CreateAdminResult = { status: "ok"; userId: string; token: string; expiresAt: Date } | ManageError;

/**
 * Creates an admin account without a password and returns a one-time
 * "set your password" link token (shown once to the creator, who hands it
 * over in person). Two-factor enrolment follows at the first sign-in.
 */
export async function createAdminUser(actor: Actor, input: CreateAdminUserInput, now = new Date()): Promise<CreateAdminResult> {
  const parsed = createAdminUserSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  const data = parsed.data;
  const role = await findRole(db(), data.roleId);
  if (!role || !role.isActive || role.level < 1 || role.level > 3) return { status: "invalid", field: "invalid_role" };
  const managing = await authorizeTargetLevel(actor, role.level, undefined, true);

  const taken = await identifierTaken(db(), { username: data.username, email: data.email });
  if (taken) return { status: "taken", field: taken };

  const link = newPasswordLink();
  const expiresAt = passwordLinkExpiry("admin_invite", now);
  try {
    const userId = await transaction(async (tx) => {
      const id = await insertAdminUser(tx, { ...data, assignedById: managing.userId });
      await createPasswordLink(tx, { purpose: "admin_invite", userId: id, identifier: data.username, valueHash: link.hash, expiresAt, now });
      await recordAudit(tx, actor.meta, {
        actorUserId: managing.userId,
        action: accountAuditAction(role.level, "created"),
        entityType: "user",
        entityId: id,
        after: { username: data.username, email: data.email, name: data.name, role: role.key, level: role.level },
      });
      return id;
    });
    return { status: "ok", userId, token: link.token, expiresAt };
  } catch (error) {
    // Two creators racing for the same username or email.
    if (String(error).includes("Unique constraint")) return { status: "taken", field: "username" };
    throw error;
  }
}

export async function updateAdminUser(actor: Actor, userId: string, input: UpdateAdminUserInput): Promise<{ status: "ok" } | ManageError> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  const parsed = updateAdminUserSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: firstIssue(parsed.error) };
  const taken = await identifierTaken(db(), { email: parsed.data.email, exceptUserId: userId });
  if (taken) return { status: "taken", field: taken };
  await transaction(async (tx) => {
    await updateAdminUserDetails(tx, userId, parsed.data);
    await recordAudit(tx, actor.meta, {
      actorUserId: actor.userId,
      action: accountAuditAction(target.level, "updated"),
      entityType: "user",
      entityId: userId,
      before: { name: target.row.name, email: target.row.email },
      after: parsed.data,
    });
  });
  return { status: "ok" };
}

/**
 * Replaces the account's admin role. Both the current and the new level must
 * be manageable by the actor. The account's sessions are revoked, so the new
 * permissions start with a fresh sign-in.
 */
export async function changeAdminRole(actor: Actor, userId: string, roleId: string, now = new Date()): Promise<{ status: "ok" } | ManageError> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  const role = /^[0-9a-f-]{36}$/i.test(roleId) ? await findRole(db(), roleId) : null;
  if (!role || !role.isActive || role.level < 1 || role.level > 3) return { status: "invalid", field: "invalid_role" };
  await authorizeTargetLevel(actor, role.level, userId, true);
  if (role.id === target.row.role.id && target.level === role.level) return { status: "ok" };
  try {
    await transaction(async (tx) => {
      await replaceAdminRole(tx, userId, role.id, actor.userId!);
      await revokeUserSessions(tx, userId, "role_changed", now);
      await recordAudit(tx, actor.meta, {
        actorUserId: actor.userId,
        action: accountAuditAction(Math.min(target.level, role.level), "role_changed"),
        entityType: "user",
        entityId: userId,
        before: { role: target.row.role.key, level: target.level },
        after: { role: role.key, level: role.level },
      });
    });
  } catch (error) {
    if (isLastSuperAdminError(error)) return { status: "last_super_admin" };
    throw error;
  }
  return { status: "ok" };
}

/** Disables (signs out everywhere, blocks sign-in) or re-enables an account. */
export async function setAdminStatus(
  actor: Actor,
  userId: string,
  status: "active" | "disabled",
  now = new Date(),
): Promise<{ status: "ok" } | ManageError> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  if (target.row.status === status) return { status: "ok" };
  try {
    await transaction(async (tx) => {
      await setUserStatus(tx, userId, status);
      if (status === "disabled") await revokeUserSessions(tx, userId, "account_disabled", now);
      await recordAudit(tx, actor.meta, {
        actorUserId: actor.userId,
        action: accountAuditAction(target.level, status === "disabled" ? "disabled" : "enabled"),
        entityType: "user",
        entityId: userId,
        before: { status: target.row.status },
        after: { status },
      });
    });
  } catch (error) {
    if (isLastSuperAdminError(error)) return { status: "last_super_admin" };
    throw error;
  }
  return { status: "ok" };
}

export type PasswordLinkResult = { status: "ok"; token: string; purpose: PasswordLinkPurpose; expiresAt: Date } | ManageError;

/**
 * Issues a one-time password link for another admin: a reset link (30
 * minutes), or a new invitation (72 hours) when the account never had a
 * password. Earlier unused links stop working. The current password keeps
 * working until the link is used; using it signs the account out everywhere.
 */
export async function issuePasswordLink(actor: Actor, userId: string, now = new Date()): Promise<PasswordLinkResult> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  const purpose: PasswordLinkPurpose = target.row.hasPassword ? "password_reset" : "admin_invite";
  const link = newPasswordLink();
  const expiresAt = passwordLinkExpiry(purpose, now);
  await transaction(async (tx) => {
    await createPasswordLink(tx, { purpose, userId, identifier: target.row.username ?? userId, valueHash: link.hash, expiresAt, now });
    await recordAudit(tx, actor.meta, {
      actorUserId: actor.userId,
      action: accountAuditAction(target.level, "password_link_issued"),
      entityType: "user",
      entityId: userId,
      after: { purpose, expiresAt: expiresAt.toISOString() },
    });
  });
  return { status: "ok", token: link.token, purpose, expiresAt };
}

/**
 * Removes another admin's two-factor enrolment (lost phone and backup codes).
 * They must enrol again at their next sign-in; all their sessions end now.
 */
export async function resetAdminMfa(actor: Actor, userId: string, now = new Date()): Promise<{ status: "ok" } | ManageError> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  await transaction(async (tx) => {
    const removed = await deleteMfa(tx, userId);
    await revokeUserSessions(tx, userId, "mfa_reset", now);
    await recordAudit(tx, actor.meta, {
      actorUserId: actor.userId,
      action: accountAuditAction(target.level, "mfa_reset"),
      entityType: "user",
      entityId: userId,
      before: { twoFactorEnabled: removed },
      after: { twoFactorEnabled: false },
    });
  });
  await recordSecurityEvent(actor.meta, { type: "mfa.reset_by_admin", severity: "warning", userId, details: { by: actor.userId } });
  return { status: "ok" };
}

/** Signs another admin out on every device. */
export async function revokeAdminSessions(actor: Actor, userId: string, now = new Date()): Promise<{ status: "ok"; count: number } | ManageError> {
  const target = await loadTarget(actor, userId, true);
  if ("status" in target) return target;
  if (userId === actor.userId) return { status: "self" };
  const count = await transaction(async (tx) => {
    const n = await revokeUserSessions(tx, userId, "revoked_by_admin", now);
    await recordAudit(tx, actor.meta, {
      actorUserId: actor.userId,
      action: accountAuditAction(target.level, "sessions_revoked"),
      entityType: "user",
      entityId: userId,
      after: { count: n },
    });
    return n;
  });
  return { status: "ok", count };
}
