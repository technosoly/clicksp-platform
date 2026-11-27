import "server-only";
import { db, type DbClient } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import { logger } from "@/lib/logger";
import { countSecurityEvents, insertAuditLog, insertSecurityEvent } from "../repo/audit-repo";

const SECRET_KEYS = /password|secret|token|code|hash|otp/i;

/** Replaces values of secret-looking keys, so audit rows never hold secrets. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes an audit log row. Pass the transaction of the business change, so the
 * audit row commits or rolls back with it. Internal API for other modules'
 * services; it does no authorization of its own (the caller already did).
 */
export async function recordAudit(client: DbClient, meta: RequestMeta, input: AuditInput): Promise<void> {
  await insertAuditLog(client, {
    actorType: input.actorUserId ? "user" : "system",
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: redact(input.before),
    after: redact(input.after),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

export interface SecurityEventInput {
  type: string;
  severity?: "info" | "warning" | "critical";
  userId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Records a security event (denied access, rate limit, failed MFA, ...).
 * Written outside the caller's transaction on purpose, so a denial is kept
 * even when the request then fails. Never throws: logging must not turn a
 * denial into a 500.
 */
export async function recordSecurityEvent(meta: RequestMeta, input: SecurityEventInput, client: DbClient = db()): Promise<void> {
  try {
    await insertSecurityEvent(client, {
      type: input.type,
      severity: input.severity ?? "warning",
      userId: input.userId ?? null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      details: input.details ? (redact(input.details) as Record<string, unknown>) : undefined,
    });
  } catch (error) {
    logger.error("security event not recorded", { type: input.type, error: String(error) });
  }
}

/** How many security events of a type this IP caused since a time (for limits counted in PostgreSQL, ADR 0002). */
export async function countRecentSecurityEvents(type: string, ipAddress: string | null, since: Date): Promise<number> {
  return countSecurityEvents(db(), { type, ipAddress, since });
}
