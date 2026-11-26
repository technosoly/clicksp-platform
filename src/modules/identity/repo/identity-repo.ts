/**
 * The only code in the identity module that touches the database.
 * Every function takes a client so callers can run it inside a transaction.
 */
import type { DbClient } from "@/lib/db";
import type { SessionKind } from "../domain/policy";

// ---------- users and credentials ----------

export interface AdminCredential {
  userId: string;
  status: "active" | "pending_verification" | "locked" | "disabled";
  passwordHash: string | null;
  name: string;
  username: string | null;
  email: string | null;
}

/** Finds a user by username or email (both stored lower-case) with their password hash. */
export async function findCredentialByIdentifier(client: DbClient, identifier: string): Promise<AdminCredential | null> {
  const user = await client.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
    select: {
      id: true,
      status: true,
      name: true,
      username: true,
      email: true,
      accounts: { where: { providerId: "credential" }, select: { passwordHash: true }, take: 1 },
    },
  });
  if (!user) return null;
  return {
    userId: user.id,
    status: user.status,
    passwordHash: user.accounts[0]?.passwordHash ?? null,
    name: user.name,
    username: user.username,
    email: user.email,
  };
}

export async function getUserSummary(client: DbClient, userId: string) {
  return client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phoneNumber: true,
      status: true,
      twoFactorEnabled: true,
      lastLoginAt: true,
    },
  });
}

export async function setLastLogin(client: DbClient, userId: string, at: Date): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
}

export async function findUserIdByPhone(client: DbClient, phone: string): Promise<{ id: string; status: string } | null> {
  return client.user.findUnique({ where: { phoneNumber: phone }, select: { id: true, status: true } });
}

/** Creates a customer (level 0 role) identified by a verified phone number. */
export async function createCustomer(client: DbClient, phone: string): Promise<string> {
  const role = await client.role.findUniqueOrThrow({ where: { key: "customer" }, select: { id: true } });
  const user = await client.user.create({
    data: { phoneNumber: phone, phoneNumberVerified: true, status: "active" },
    select: { id: true },
  });
  await client.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

export async function markPhoneVerified(client: DbClient, userId: string): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { phoneNumberVerified: true } });
}

/** Lowest active admin level (1..3) the user holds now, or null for non-admins. */
export async function adminLevel(client: DbClient, userId: string, now: Date): Promise<number | null> {
  const rows = await client.userRole.findMany({
    where: {
      userId,
      role: { isActive: true, level: { gte: 1, lte: 3 } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { role: { select: { level: true } } },
  });
  if (rows.length === 0) return null;
  return Math.min(...rows.map((r) => r.role.level));
}

// ---------- login attempts ----------

export async function recordLoginAttempt(
  client: DbClient,
  row: {
    identifier: string;
    userId: string | null;
    success: boolean;
    failureReason: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await client.loginAttempt.create({ data: row });
}

export async function countFailedLogins(
  client: DbClient,
  filter: { identifier?: string; ipAddress?: string; since: Date },
): Promise<number> {
  return client.loginAttempt.count({
    where: {
      success: false,
      createdAt: { gte: filter.since },
      ...(filter.identifier !== undefined ? { identifier: filter.identifier } : {}),
      ...(filter.ipAddress !== undefined ? { ipAddress: filter.ipAddress } : {}),
    },
  });
}

// ---------- sessions ----------

export async function createSession(
  client: DbClient,
  row: {
    userId: string;
    tokenHash: string;
    kind: SessionKind;
    ipAddress: string | null;
    userAgent: string | null;
    mfaVerifiedAt: Date | null;
    expiresAt: Date;
    now: Date;
  },
): Promise<string> {
  const session = await client.session.create({
    data: {
      userId: row.userId,
      tokenHash: row.tokenHash,
      kind: row.kind,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      mfaVerifiedAt: row.mfaVerifiedAt,
      lastSeenAt: row.now,
      createdAt: row.now,
      expiresAt: row.expiresAt,
    },
    select: { id: true },
  });
  return session.id;
}

export async function findSessionByTokenHash(client: DbClient, tokenHash: string) {
  return client.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      kind: true,
      mfaVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { status: true } },
    },
  });
}

export async function touchSession(client: DbClient, sessionId: string, at: Date): Promise<void> {
  await client.session.update({ where: { id: sessionId }, data: { lastSeenAt: at } });
}

export async function setSessionMfaVerified(client: DbClient, sessionId: string, at: Date): Promise<void> {
  await client.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: at, lastSeenAt: at } });
}

export async function revokeSession(client: DbClient, sessionId: string, reason: string, at: Date): Promise<void> {
  await client.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: at, revokedReason: reason },
  });
}

export async function revokeUserSessions(
  client: DbClient,
  userId: string,
  reason: string,
  at: Date,
  kind?: SessionKind,
): Promise<number> {
  const result = await client.session.updateMany({
    where: { userId, revokedAt: null, ...(kind ? { kind } : {}) },
    data: { revokedAt: at, revokedReason: reason },
  });
  return result.count;
}

// ---------- MFA ----------

export async function getMfa(client: DbClient, userId: string) {
  return client.userMfa.findUnique({ where: { userId } });
}

/** Starts (or restarts) TOTP enrolment with a new, not yet verified secret. */
export async function savePendingMfa(client: DbClient, userId: string, secretEncrypted: string): Promise<void> {
  await client.userMfa.upsert({
    where: { userId },
    create: { userId, secretEncrypted, backupCodeHashes: [], isVerified: false },
    update: { secretEncrypted, backupCodeHashes: [], isVerified: false, failedVerificationCount: 0, lockedUntil: null },
  });
}

export async function completeMfaEnrolment(
  client: DbClient,
  userId: string,
  backupCodeHashes: string[],
  usedAt: Date,
): Promise<void> {
  await client.userMfa.update({
    where: { userId },
    data: { isVerified: true, backupCodeHashes, failedVerificationCount: 0, lockedUntil: null, lastUsedAt: usedAt },
  });
  await client.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
}

/** Counts a failed code; locks MFA for lockMinutes once maxFailures is reached. */
export async function recordMfaFailure(
  client: DbClient,
  userId: string,
  maxFailures: number,
  lockUntil: Date,
): Promise<{ locked: boolean }> {
  const mfa = await client.userMfa.update({
    where: { userId },
    data: { failedVerificationCount: { increment: 1 } },
    select: { failedVerificationCount: true },
  });
  if (mfa.failedVerificationCount >= maxFailures) {
    await client.userMfa.update({ where: { userId }, data: { lockedUntil: lockUntil, failedVerificationCount: 0 } });
    return { locked: true };
  }
  return { locked: false };
}

/**
 * Records a successful code. Conditional on last_used_at so two concurrent
 * requests with the same code cannot both succeed (replay protection).
 */
export async function recordMfaSuccess(
  client: DbClient,
  userId: string,
  usedAt: Date,
  previousUsedAt: Date | null,
): Promise<boolean> {
  const result = await client.userMfa.updateMany({
    where: { userId, lastUsedAt: previousUsedAt },
    data: { lastUsedAt: usedAt, failedVerificationCount: 0, lockedUntil: null },
  });
  return result.count === 1;
}

/** Removes one backup code; false when it was already used (concurrent request). */
export async function consumeBackupCode(client: DbClient, userId: string, codeHash: string, at: Date): Promise<boolean> {
  const count = await client.$executeRaw`
    UPDATE user_mfa
       SET backup_code_hashes = array_remove(backup_code_hashes, ${codeHash}),
           failed_verification_count = 0, locked_until = NULL, updated_at = ${at}
     WHERE user_id = ${userId}::uuid AND ${codeHash} = ANY(backup_code_hashes)`;
  return count === 1;
}

// ---------- verification tokens (OTP) ----------

export async function createVerificationToken(
  client: DbClient,
  row: { id: string; purpose: "phone_otp"; identifier: string; userId: string | null; valueHash: string; expiresAt: Date; now: Date },
): Promise<void> {
  await client.verificationToken.create({
    data: {
      id: row.id,
      purpose: row.purpose,
      identifier: row.identifier,
      userId: row.userId,
      valueHash: row.valueHash,
      expiresAt: row.expiresAt,
      createdAt: row.now,
    },
  });
}

/** The newest token for the identifier; older ones are never accepted. */
export async function latestVerificationToken(client: DbClient, purpose: "phone_otp", identifier: string) {
  return client.verificationToken.findFirst({
    where: { purpose, identifier },
    orderBy: { createdAt: "desc" },
  });
}

/** Adds one attempt unless the token is used up; false when no attempt is left. */
export async function spendVerificationAttempt(client: DbClient, tokenId: string, maxAttempts: number): Promise<boolean> {
  const result = await client.verificationToken.updateMany({
    where: { id: tokenId, consumedAt: null, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  return result.count === 1;
}

/** Marks the token used; false if another request consumed it first. */
export async function consumeVerificationToken(client: DbClient, tokenId: string, at: Date): Promise<boolean> {
  const result = await client.verificationToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: at },
  });
  return result.count === 1;
}

export async function countVerificationTokens(
  client: DbClient,
  filter: { purpose: "phone_otp"; identifier: string; since: Date },
): Promise<number> {
  return client.verificationToken.count({
    where: { purpose: filter.purpose, identifier: filter.identifier, createdAt: { gte: filter.since } },
  });
}
