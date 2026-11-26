import "server-only";
import type { DbClient } from "@/lib/db";
import { db } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import { randomToken, sha256Hex } from "@/lib/security/tokens";
import {
  SESSION_TOUCH_INTERVAL_MS,
  sessionExpiry,
  sessionState,
  type SecurityPolicy,
  type SessionKind,
} from "../domain/policy";
import {
  createSession,
  findSessionByTokenHash,
  revokeSession,
  touchSession,
} from "../repo/identity-repo";

export interface IssuedSession {
  /** Raw token for the cookie. Never stored or logged. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/** Creates a session; only the SHA-256 of the token is stored. */
export async function issueSession(
  client: DbClient,
  input: {
    userId: string;
    kind: SessionKind;
    mfaVerifiedAt: Date | null;
    mfaPending: boolean;
    meta: RequestMeta;
    policy: SecurityPolicy;
    now: Date;
  },
): Promise<IssuedSession> {
  const token = randomToken(32);
  const expiresAt = sessionExpiry(input.kind, input.mfaPending, input.now, input.policy);
  const sessionId = await createSession(client, {
    userId: input.userId,
    tokenHash: sha256Hex(token),
    kind: input.kind,
    ipAddress: input.meta.ipAddress,
    userAgent: input.meta.userAgent,
    mfaVerifiedAt: input.mfaVerifiedAt,
    expiresAt,
    now: input.now,
  });
  return { token, sessionId, expiresAt };
}

export interface ValidSession {
  sessionId: string;
  userId: string;
  kind: SessionKind;
  mfaVerifiedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Looks up a session by its cookie token. Returns null unless the session is
 * of the expected kind, not revoked, not expired, not idle, and its user is
 * active. Refreshes last_seen_at at most once a minute.
 */
export async function resolveSession(
  token: string | undefined,
  kind: SessionKind,
  policy: SecurityPolicy,
  now = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const session = await findSessionByTokenHash(db(), sha256Hex(token));
  if (!session || session.kind !== kind) return null;
  if (session.user.status !== "active") return null;
  const state = sessionState(kind, session, now, policy);
  if (state !== "active") {
    if (state === "idle") await revokeSession(db(), session.id, "idle_timeout", now);
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await touchSession(db(), session.id, now);
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    kind,
    mfaVerifiedAt: session.mfaVerifiedAt,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

/** Logout: revokes the session behind the token (if any). */
export async function endSession(token: string | undefined, kind: SessionKind, now = new Date()): Promise<string | null> {
  if (!token) return null;
  const session = await findSessionByTokenHash(db(), sha256Hex(token));
  if (!session || session.kind !== kind) return null;
  await revokeSession(db(), session.id, "logout", now);
  return session.userId;
}
