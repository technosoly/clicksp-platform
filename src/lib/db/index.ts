import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * The single Prisma client for the app. Only `src/modules/<module>/repo/`
 * and infrastructure code (health checks) may import it; see CLAUDE.md.
 * In development the instance is kept on globalThis so hot reloads do not
 * open a new connection pool each time.
 */
const globalForDb = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export function db(): PrismaClient {
  if (!globalForDb.prisma) {
    globalForDb.prisma = createClient();
  }
  return globalForDb.prisma;
}

/** Lightweight connectivity check used by the readiness endpoint. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** A client or an open transaction: repositories accept either. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Runs fn in one database transaction (critical writes, see CLAUDE.md).
 * Prisma gives up on a transaction after 5 seconds; work that writes many
 * rows (completing a large stock count) passes a longer timeout.
 */
export function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
  return options?.timeoutMs ? db().$transaction(fn, { timeout: options.timeoutMs, maxWait: 10_000 }) : db().$transaction(fn);
}

/** PostgreSQL gave up on one of two transactions waiting for each other (SQLSTATE 40P01). */
export function isDeadlock(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { code?: unknown }).code ?? "")}` : "";
  return text.includes("40P01") || text.includes("deadlock detected");
}
