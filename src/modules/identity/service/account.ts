import "server-only";
import { db, transaction } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import { checkPasswordPolicy, hashPassword, verifyPassword, type PasswordProblem } from "@/lib/security/password";
import { sha256Hex } from "@/lib/security/tokens";
import { recordAudit, recordSecurityEvent } from "@/modules/audit/service/audit";
import { countSecurityEvents } from "@/modules/audit/repo/audit-repo";
import type { Actor } from "@/modules/rbac/domain/actor";
import { RESET_MAX_INVALID_PER_IP, RESET_WINDOW_MINUTES } from "../domain/admin-account";
import {
  consumePasswordLink,
  findPasswordLink,
  getPasswordHash,
  listActiveSessions,
  revokeOtherSessions,
  revokeSessionOf,
  setPasswordHash,
  strongestAdminLevel,
} from "../repo/admin-users-repo";
import { getUserSummary, revokeUserSessions } from "../repo/identity-repo";
import { UnauthenticatedError } from "./errors";

/**
 * An admin's own account: profile, password change, sessions, and the
 * one-time password links (invitation and reset). Self-service needs no
 * permission key: it only ever touches the signed-in user's own rows, found
 * from the session, never from an id the browser sends.
 */

function self(actor: Actor): { userId: string; sessionId: string } {
  if (actor.kind !== "admin" || !actor.userId || !actor.sessionId) throw new UnauthenticatedError();
  return { userId: actor.userId, sessionId: actor.sessionId };
}

export async function getOwnAccount(actor: Actor, now = new Date()) {
  const { userId, sessionId } = self(actor);
  const [user, sessions] = await Promise.all([getUserSummary(db(), userId), listActiveSessions(db(), userId, "admin", now)]);
  if (!user) throw new UnauthenticatedError();
  return { user, sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })) };
}

/** Wrong current passwords per account in the window, before changes are refused. */
const CHANGE_MAX_FAILURES = 5;
const CHANGE_WINDOW_MINUTES = 15;

export type ChangePasswordResult =
  | { status: "ok" }
  | { status: "wrong_password" }
  | { status: "rate_limited" }
  | { status: "weak_password"; problem: PasswordProblem | "same_as_current" };

/**
 * Changes the signed-in admin's password. Needs the current password; every
 * other session of the account is signed out, this one stays.
 */
export async function changeOwnPassword(
  actor: Actor,
  input: { current: string; next: string },
  now = new Date(),
): Promise<ChangePasswordResult> {
  const { userId, sessionId } = self(actor);
  const since = new Date(now.getTime() - CHANGE_WINDOW_MINUTES * 60_000);
  if ((await countSecurityEvents(db(), { type: "password.change_failed", userId, since })) >= CHANGE_MAX_FAILURES) {
    return { status: "rate_limited" };
  }
  const [hash, user] = await Promise.all([getPasswordHash(db(), userId), getUserSummary(db(), userId)]);
  if (!hash || !user || !(await verifyPassword(hash, input.current.slice(0, 1024)))) {
    await recordSecurityEvent(actor.meta, { type: "password.change_failed", severity: "warning", userId });
    return { status: "wrong_password" };
  }
  const problem = checkPasswordPolicy(input.next, [user.username ?? "", user.email ?? "", user.name]);
  if (problem) return { status: "weak_password", problem };
  if (input.next === input.current) return { status: "weak_password", problem: "same_as_current" };
  const newHash = await hashPassword(input.next);
  await transaction(async (tx) => {
    await setPasswordHash(tx, userId, newHash, now);
    const signedOut = await revokeOtherSessions(tx, userId, sessionId, "password_changed", now);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "auth.password_changed",
      entityType: "user",
      entityId: userId,
      after: { otherSessionsSignedOut: signedOut },
    });
  });
  return { status: "ok" };
}

/** Signs out one of the admin's own sessions (not the current one: use sign-out). */
export async function revokeOwnSession(actor: Actor, sessionId: string, now = new Date()): Promise<boolean> {
  const me = self(actor);
  if (sessionId === me.sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  return transaction(async (tx) => {
    // Scoped to the actor's own user id: another user's session id does nothing.
    const done = await revokeSessionOf(tx, me.userId, sessionId, "revoked_by_user", now);
    if (done) await recordAudit(tx, actor.meta, { actorUserId: me.userId, action: "auth.session_revoked", entityType: "session", entityId: sessionId });
    return done;
  });
}

export async function revokeOwnOtherSessions(actor: Actor, now = new Date()): Promise<number> {
  const me = self(actor);
  return transaction(async (tx) => {
    const count = await revokeOtherSessions(tx, me.userId, me.sessionId, "revoked_by_user", now);
    await recordAudit(tx, actor.meta, { actorUserId: me.userId, action: "auth.other_sessions_revoked", entityType: "user", entityId: me.userId, after: { count } });
    return count;
  });
}

// ---------------------------------------------------------------------------
// One-time password links (no session: the link itself is the credential)
// ---------------------------------------------------------------------------

export type PasswordLinkUseResult =
  | { status: "ok"; purpose: "admin_invite" | "password_reset" }
  | { status: "invalid_link" }
  | { status: "rate_limited" }
  | { status: "weak_password"; problem: PasswordProblem };

/**
 * Sets a password from a one-time link. The same answer is given for an
 * unknown, used or expired link. Using it ends every session of the account
 * (a reset after a suspected compromise must sign the attacker out too);
 * two-factor sign-in is not changed.
 */
export async function completePasswordLink(
  input: { token: string; password: string },
  meta: RequestMeta,
  now = new Date(),
): Promise<PasswordLinkUseResult> {
  const since = new Date(now.getTime() - RESET_WINDOW_MINUTES * 60_000);
  if ((await countSecurityEvents(db(), { type: "password_link.invalid", ipAddress: meta.ipAddress, since })) >= RESET_MAX_INVALID_PER_IP) {
    await recordSecurityEvent(meta, { type: "password_link.rate_limited", severity: "warning" });
    return { status: "rate_limited" };
  }
  const invalid = async (reason: string, userId: string | null = null): Promise<PasswordLinkUseResult> => {
    await recordSecurityEvent(meta, { type: "password_link.invalid", severity: "warning", userId, details: { reason } });
    return { status: "invalid_link" };
  };
  const token = input.token.trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return invalid("malformed");
  const link = await findPasswordLink(db(), sha256Hex(token));
  if (!link) return invalid("unknown");
  if (link.consumedAt || link.expiresAt <= now) return invalid(link.consumedAt ? "used" : "expired", link.userId);
  const [user, level] = await Promise.all([getUserSummary(db(), link.userId), strongestAdminLevel(db(), link.userId)]);
  if (!user || user.status !== "active" || level === null) return invalid("account", link.userId);

  // Checked before the link is used, so a weak password doesn't burn the link.
  const problem = checkPasswordPolicy(input.password, [user.username ?? "", user.email ?? "", user.name]);
  if (problem) return { status: "weak_password", problem };
  const passwordHash = await hashPassword(input.password);

  const ok = await transaction(async (tx) => {
    if (!(await consumePasswordLink(tx, link.id, now))) return false;
    await setPasswordHash(tx, link.userId, passwordHash, now);
    const signedOut = await revokeUserSessions(tx, link.userId, "password_reset", now);
    await recordAudit(tx, meta, {
      actorUserId: link.userId,
      action: link.purpose === "admin_invite" ? "auth.password_set" : "auth.password_reset",
      entityType: "user",
      entityId: link.userId,
      after: { sessionsSignedOut: signedOut },
    });
    return true;
  });
  if (!ok) return invalid("race", link.userId);
  return { status: "ok", purpose: link.purpose };
}
