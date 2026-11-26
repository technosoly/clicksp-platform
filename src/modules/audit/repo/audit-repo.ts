import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

export interface AuditRow {
  actorType: "user" | "system" | "job";
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * Inserts an audit row. seq, prev_hash and hash are filled by the
 * audit_logs_chain trigger (BEFORE INSERT), so raw SQL is used: Prisma's
 * create() would require a hash value.
 */
export async function insertAuditLog(client: DbClient, row: AuditRow): Promise<void> {
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  await client.$executeRaw`
    INSERT INTO audit_logs (actor_type, actor_user_id, action, entity_type, entity_id, before, after,
                            ip_address, user_agent, request_id)
    VALUES (${row.actorType}::actor_type, ${row.actorUserId}::uuid, ${row.action}, ${row.entityType},
            ${row.entityId}::uuid, ${json(row.before)}::jsonb, ${json(row.after)}::jsonb,
            ${row.ipAddress}::inet, ${row.userAgent}, ${row.requestId})`;
}

export interface SecurityEventRow {
  type: string;
  severity: "info" | "warning" | "critical";
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  details?: Record<string, unknown>;
}

export async function insertSecurityEvent(client: DbClient, row: SecurityEventRow): Promise<void> {
  await client.securityEvent.create({
    data: {
      type: row.type,
      severity: row.severity,
      userId: row.userId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      details: (row.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}

export async function countSecurityEvents(
  client: DbClient,
  filter: { type: string; ipAddress?: string | null; userId?: string | null; since: Date },
): Promise<number> {
  return client.securityEvent.count({
    where: {
      type: filter.type,
      occurredAt: { gte: filter.since },
      ...(filter.ipAddress !== undefined ? { ipAddress: filter.ipAddress } : {}),
      ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
    },
  });
}

export interface AuditListFilter {
  /** Only actions starting with one of these prefixes (null = all). */
  actionPrefixes: readonly string[] | null;
  /** Optional exact entity filter (e.g. one user's history). */
  entityId?: string;
  page: number;
  pageSize: number;
}

/** Newest first, with the actor's display name. */
export async function listAuditLogs(client: DbClient, filter: AuditListFilter) {
  const where = {
    ...(filter.actionPrefixes ? { OR: filter.actionPrefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
  };
  const [rows, total] = await Promise.all([
    client.auditLog.findMany({
      where,
      orderBy: { seq: "desc" },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      select: {
        id: true,
        seq: true,
        occurredAt: true,
        actorType: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ipAddress: true,
        actorUser: { select: { id: true, username: true, name: true } },
      },
    }),
    client.auditLog.count({ where }),
  ]);
  return { rows, total };
}

export async function listSecurityEvents(client: DbClient, filter: { page: number; pageSize: number }) {
  const [rows, total] = await Promise.all([
    client.securityEvent.findMany({
      orderBy: { occurredAt: "desc" },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
      select: { id: true, type: true, severity: true, occurredAt: true, ipAddress: true, details: true, user: { select: { username: true, name: true } } },
    }),
    client.securityEvent.count(),
  ]);
  return { rows, total };
}
