import "server-only";
import { db, transaction } from "@/lib/db";
import { authSecret } from "@/lib/env";
import type { RequestMeta } from "@/lib/http/request-meta";
import { toEnDigits } from "@/lib/persian-text";
import { decryptString, deriveKey, encryptString } from "@/lib/security/encryption";
import { verifyPassword, verifyPasswordAgainstDummy } from "@/lib/security/password";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@/lib/security/tokens";
import { generateTotpSecret, totpStep, totpUri, TOTP_STEP_SECONDS, verifyTotp } from "@/lib/security/totp";
import { recordAudit, recordSecurityEvent } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import type { EffectivePermissions } from "@/modules/rbac/domain/authorize";
import { loadEffectivePermissions } from "@/modules/rbac/service/authorize";
import { getSecurityPolicy } from "@/modules/settings/service/security-policy";
import { ACCOUNT_LOGIN_HARD_LIMIT, isMfaRequired, MFA, type SecurityPolicy } from "../domain/policy";
import {
  adminLevel,
  completeMfaEnrolment,
  consumeBackupCode,
  countFailedLogins,
  findCredentialByIdentifier,
  getMfa,
  getUserSummary,
  isActiveUser,
  recordLoginAttempt,
  lockMfa,
  reserveMfaAttempt,
  recordMfaSuccess,
  revokeSession,
  savePendingMfa,
  setLastLogin,
  setSessionMfaVerified,
} from "../repo/identity-repo";
import { issueSession, resolveSession, type IssuedSession, type ValidSession } from "./sessions";

const ISSUER = "Clicksp";

/** Usernames and emails are stored lower-case; accept Persian digits and stray spaces. */
export function normalizeLoginIdentifier(input: string): string {
  return toEnDigits(input.normalize("NFKC")).trim().toLowerCase().slice(0, 254);
}

function totpKey(): Buffer {
  return deriveKey(authSecret(), "totp-secret");
}

// ---------------------------------------------------------------------------
// Admin context: the session plus what the admin may do.
// ---------------------------------------------------------------------------

export type AdminMfaState = "ok" | "challenge" | "setup";

export interface AdminContext {
  session: ValidSession;
  level: number;
  permissions: EffectivePermissions;
  /** ok: full access; challenge: must enter a TOTP code; setup: must enrol TOTP first. */
  mfa: AdminMfaState;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  policy: SecurityPolicy;
}

/**
 * Resolves the admin behind a session token. Null when the token is invalid
 * or the user no longer holds an admin role (role removed = signed out).
 */
export async function getAdminContext(token: string | undefined, now = new Date()): Promise<AdminContext | null> {
  const policy = await getSecurityPolicy();
  const session = await resolveSession(token, "admin", policy, now);
  if (!session) return null;
  const level = await adminLevel(db(), session.userId, now);
  if (level === null) return null;
  const permissions = await loadEffectivePermissions(session.userId, now);
  const mfaRow = await getMfa(db(), session.userId);
  const mfaEnrolled = mfaRow?.isVerified === true;
  const mfaRequired = isMfaRequired(level, permissions.keys(), policy);
  let mfa: AdminMfaState = "ok";
  if (session.mfaVerifiedAt === null) {
    if (mfaEnrolled) mfa = "challenge";
    else if (mfaRequired) mfa = "setup";
  }
  return { session, level, permissions, mfa, mfaRequired, mfaEnrolled, policy };
}

export function adminActor(ctx: AdminContext, meta: RequestMeta): Actor {
  return {
    kind: "admin",
    userId: ctx.session.userId,
    sessionId: ctx.session.sessionId,
    level: ctx.level,
    permissions: ctx.permissions,
    mfaVerifiedAt: ctx.session.mfaVerifiedAt,
    meta,
  };
}

/**
 * The actor for work an admin started that finishes in the background (an
 * import they confirmed): their permissions as they are now, so a role
 * removed or an account disabled meanwhile stops the work. Null when they
 * are no longer an active admin. No session, so no step-up MFA.
 */
export async function backgroundAdminActor(userId: string, requestId: string, now = new Date()): Promise<Actor | null> {
  if (!(await isActiveUser(db(), userId))) return null;
  const level = await adminLevel(db(), userId, now);
  if (level === null) return null;
  return {
    kind: "admin",
    userId,
    sessionId: null,
    level,
    permissions: await loadEffectivePermissions(userId, now),
    mfaVerifiedAt: null,
    meta: { ipAddress: null, userAgent: "background job", requestId },
  };
}

export async function getAdminProfile(userId: string) {
  return getUserSummary(db(), userId);
}

// ---------------------------------------------------------------------------
// Step 1: username/email + password
// ---------------------------------------------------------------------------

export type PasswordLoginResult =
  | { status: "ok"; session: IssuedSession; next: AdminMfaState }
  | { status: "invalid" }
  | { status: "rate_limited" };

export async function adminPasswordLogin(
  input: { identifier: string; password: string },
  meta: RequestMeta,
  now = new Date(),
): Promise<PasswordLoginResult> {
  const identifier = normalizeLoginIdentifier(input.identifier);
  const policy = await getSecurityPolicy();
  const since = new Date(now.getTime() - policy.loginWindowMinutes * 60_000);

  // Limits (requests without a valid client IP share one "unknown" bucket, so
  // a missing or spoofed header never switches a limit off):
  // - per account AND IP: stops guessing without letting a stranger lock the
  //   owner out from their own address;
  // - per IP: stops spraying many accounts;
  // - per account from anywhere, a high hard limit against distributed guessing.
  const [byAccountIp, byIp, byAccount] = await Promise.all([
    countFailedLogins(db(), { identifier, ipAddress: meta.ipAddress, since }),
    countFailedLogins(db(), { ipAddress: meta.ipAddress, since }),
    countFailedLogins(db(), { identifier, since }),
  ]);
  const scope =
    byAccountIp >= policy.loginMaxPerAccount
      ? "account_ip"
      : byIp >= policy.loginMaxPerIp
        ? "ip"
        : byAccount >= ACCOUNT_LOGIN_HARD_LIMIT
          ? "account"
          : null;
  if (scope) {
    await recordSecurityEvent(meta, {
      type: "login.rate_limited",
      severity: scope === "account" ? "critical" : "warning",
      details: { scope, identifier },
    });
    return { status: "rate_limited" };
  }

  const fail = async (userId: string | null, reason: string): Promise<PasswordLoginResult> => {
    await recordLoginAttempt(db(), {
      identifier,
      userId,
      success: false,
      failureReason: reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { status: "invalid" };
  };

  const password = input.password.slice(0, 1024);
  const credential = identifier ? await findCredentialByIdentifier(db(), identifier) : null;
  if (!credential || !credential.passwordHash) {
    await verifyPasswordAgainstDummy(password);
    return fail(credential?.userId ?? null, "unknown_user");
  }
  if (!(await verifyPassword(credential.passwordHash, password))) return fail(credential.userId, "bad_password");
  // Same answer as a wrong password, so the form never reveals account state.
  if (credential.status !== "active") return fail(credential.userId, `status_${credential.status}`);
  const level = await adminLevel(db(), credential.userId, now);
  if (level === null) return fail(credential.userId, "not_admin");

  const permissions = await loadEffectivePermissions(credential.userId, now);
  const mfaRow = await getMfa(db(), credential.userId);
  const enrolled = mfaRow?.isVerified === true;
  const required = isMfaRequired(level, permissions.keys(), policy);
  const next: AdminMfaState = enrolled ? "challenge" : required ? "setup" : "ok";

  const session = await transaction(async (tx) => {
    const issued = await issueSession(tx, {
      userId: credential.userId,
      kind: "admin",
      mfaVerifiedAt: null,
      mfaPending: next !== "ok",
      meta,
      policy,
      now,
    });
    await recordLoginAttempt(tx, {
      identifier,
      userId: credential.userId,
      success: true,
      failureReason: next === "ok" ? null : "mfa_pending",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    if (next === "ok") {
      await setLastLogin(tx, credential.userId, now);
      await recordAudit(tx, meta, {
        actorUserId: credential.userId,
        action: "auth.admin_login",
        entityType: "session",
        entityId: issued.sessionId,
      });
    }
    return issued;
  });
  return { status: "ok", session, next };
}

// ---------------------------------------------------------------------------
// Step 2a: TOTP challenge (sign-in or step-up)
// ---------------------------------------------------------------------------

export type MfaResult =
  | { status: "ok"; session: IssuedSession | null }
  | { status: "invalid" }
  | { status: "locked" }
  | { status: "not_allowed" };

/** Backup codes look like ABCD-EFGH; compared case- and dash-insensitively. */
function normalizeBackupCode(code: string): string {
  return toEnDigits(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Checks a TOTP (or backup) code for the signed-in admin. A pending session
 * is replaced by a new full session (session id rotates after MFA); a full
 * session just gets a fresh mfa_verified_at (step-up).
 */
export async function verifyAdminMfa(ctx: AdminContext, code: string, meta: RequestMeta, now = new Date()): Promise<MfaResult> {
  const userId = ctx.session.userId;
  const mfa = await getMfa(db(), userId);
  if (!mfa || !mfa.isVerified) return { status: "not_allowed" };
  // Reserve the attempt first (atomic), so parallel guesses can't exceed the limit.
  const attempt = await reserveMfaAttempt(db(), userId, MFA.maxFailures, now);
  if (attempt === null) {
    await recordSecurityEvent(meta, { type: "mfa.locked_attempt", userId });
    return { status: "locked" };
  }

  const clean = toEnDigits(code).replace(/\s/g, "");
  let ok = false;
  let method: "totp" | "backup_code" = "totp";
  if (/^\d{6}$/.test(clean)) {
    const secret = decryptString(totpKey(), mfa.secretEncrypted, userId);
    const lastStep = mfa.lastUsedAt ? totpStep(mfa.lastUsedAt.getTime()) : null;
    const step = verifyTotp(secret, clean, now.getTime(), lastStep);
    // Store the matched step's start time, so the same code can never be reused.
    ok = step !== null && (await recordMfaSuccess(db(), userId, new Date(step * TOTP_STEP_SECONDS * 1000), mfa.lastUsedAt));
  } else {
    method = "backup_code";
    const normalized = normalizeBackupCode(code);
    ok = normalized.length === 8 && (await consumeBackupCode(db(), userId, sha256Hex(normalized), now));
  }

  if (!ok) {
    const locked = attempt >= MFA.maxFailures;
    if (locked) await lockMfa(db(), userId, new Date(now.getTime() + MFA.lockMinutes * 60_000));
    await recordSecurityEvent(meta, {
      type: locked ? "mfa.locked" : "mfa.failed",
      severity: locked ? "critical" : "warning",
      userId,
    });
    return { status: locked ? "locked" : "invalid" };
  }

  if (ctx.session.mfaVerifiedAt !== null || ctx.mfa === "ok") {
    // Step-up on a full session.
    await setSessionMfaVerified(db(), ctx.session.sessionId, now);
    await recordAudit(db(), meta, { actorUserId: userId, action: "auth.mfa_step_up", entityType: "session", entityId: ctx.session.sessionId, after: { method } });
    return { status: "ok", session: null };
  }

  const session = await transaction(async (tx) => {
    await revokeSession(tx, ctx.session.sessionId, "rotated_after_mfa", now);
    const issued = await issueSession(tx, { userId, kind: "admin", mfaVerifiedAt: now, mfaPending: false, meta, policy: ctx.policy, now });
    await setLastLogin(tx, userId, now);
    await recordAudit(tx, meta, { actorUserId: userId, action: "auth.admin_login", entityType: "session", entityId: issued.sessionId, after: { mfa: method } });
    return issued;
  });
  if (method === "backup_code") {
    await recordSecurityEvent(meta, { type: "mfa.backup_code_used", severity: "warning", userId });
  }
  return { status: "ok", session };
}

// ---------------------------------------------------------------------------
// Step 2b: TOTP enrolment (first sign-in of an admin who must use MFA)
// ---------------------------------------------------------------------------

export interface MfaEnrolment {
  secret: string;
  uri: string;
}

/** Creates a new secret for an admin who has not enrolled yet. */
export async function startMfaEnrolment(ctx: AdminContext): Promise<MfaEnrolment | null> {
  if (ctx.mfaEnrolled) return null;
  const user = await getUserSummary(db(), ctx.session.userId);
  if (!user) return null;
  const secret = generateTotpSecret();
  if (!(await savePendingMfa(db(), user.id, encryptString(totpKey(), secret, user.id)))) return null;
  return { secret, uri: totpUri(secret, user.username ?? user.email ?? "admin", ISSUER) };
}

/** Reads the pending secret back (page reload during enrolment). */
export async function pendingMfaEnrolment(ctx: AdminContext): Promise<MfaEnrolment | null> {
  if (ctx.mfaEnrolled) return null;
  const [mfa, user] = await Promise.all([getMfa(db(), ctx.session.userId), getUserSummary(db(), ctx.session.userId)]);
  if (!mfa || mfa.isVerified || !user) return null;
  const secret = decryptString(totpKey(), mfa.secretEncrypted, user.id);
  return { secret, uri: totpUri(secret, user.username ?? user.email ?? "admin", ISSUER) };
}

const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newBackupCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
  return code;
}

export type EnrolmentResult =
  | { status: "ok"; session: IssuedSession; backupCodes: string[] }
  | { status: "invalid" }
  | { status: "not_allowed" };

/** Confirms enrolment with a first code, returns one-time backup codes and rotates the session. */
export async function confirmMfaEnrolment(
  ctx: AdminContext,
  code: string,
  meta: RequestMeta,
  now = new Date(),
): Promise<EnrolmentResult> {
  const userId = ctx.session.userId;
  const mfa = await getMfa(db(), userId);
  if (!mfa || mfa.isVerified) return { status: "not_allowed" };
  const secret = decryptString(totpKey(), mfa.secretEncrypted, userId);
  const step = verifyTotp(secret, toEnDigits(code).replace(/\s/g, ""), now.getTime());
  if (step === null) {
    await recordSecurityEvent(meta, { type: "mfa.enrol_failed", severity: "info", userId });
    return { status: "invalid" };
  }
  // 8 characters from a 32-letter alphabet (40 bits); 50 bits would need longer codes.
  const backupCodes = Array.from({ length: MFA.backupCodeCount }, newBackupCode);
  const session = await transaction(async (tx) => {
    const completed = await completeMfaEnrolment(tx, userId, backupCodes.map((c) => sha256Hex(c)), new Date(step * TOTP_STEP_SECONDS * 1000));
    if (!completed) return null;
    await revokeSession(tx, ctx.session.sessionId, "rotated_after_mfa", now);
    const issued = await issueSession(tx, { userId, kind: "admin", mfaVerifiedAt: now, mfaPending: false, meta, policy: ctx.policy, now });
    await setLastLogin(tx, userId, now);
    await recordAudit(tx, meta, { actorUserId: userId, action: "auth.mfa_enrolled", entityType: "user", entityId: userId, after: { method: "totp" } });
    await recordAudit(tx, meta, { actorUserId: userId, action: "auth.admin_login", entityType: "session", entityId: issued.sessionId, after: { mfa: "totp" } });
    return issued;
  });
  if (!session) return { status: "not_allowed" };
  return {
    status: "ok",
    session,
    backupCodes: backupCodes.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`),
  };
}

/** Admin logout writes an audit row; the session is revoked by the caller via endSession. */
export async function recordAdminLogout(userId: string, meta: RequestMeta): Promise<void> {
  await recordAudit(db(), meta, { actorUserId: userId, action: "auth.admin_logout", entityType: "user", entityId: userId });
}
