/**
 * Database access for payment providers, payment attempts and gateway
 * callbacks. The database guards the rest: a succeeded payment needs a
 * verification time and a gateway reference, a reference is used once per
 * provider, an order has at most one succeeded payment, final rows never
 * change, and callback logs are append-only.
 */
import { Prisma, type PaymentStatus } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Providers ------------------------------------------------------------------------

const providerSelect = { id: true, code: true, adapterKey: true, credentialsEnvPrefix: true, config: true, isActive: true, isSandbox: true, sortOrder: true } satisfies Prisma.PaymentProviderSelect;

export async function listProviders(client: DbClient) {
  return client.paymentProvider.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: providerSelect });
}

export async function providerByCode(client: DbClient, code: string) {
  return client.paymentProvider.findUnique({ where: { code }, select: providerSelect });
}

/** Switches a gateway on or off, creating its row (named after the adapter) the first time. */
export async function setProviderActive(tx: Tx, adapterKey: string, isActive: boolean) {
  const before = await tx.paymentProvider.findUnique({ where: { code: adapterKey }, select: { id: true, isActive: true } });
  const row = await tx.paymentProvider.upsert({
    where: { code: adapterKey },
    create: { code: adapterKey, adapterKey, credentialsEnvPrefix: adapterKey.toUpperCase(), isActive, isSandbox: adapterKey === "fake" },
    update: { isActive },
    select: { id: true },
  });
  return { id: row.id, before };
}

// Payment attempts -----------------------------------------------------------------

const paymentSelect = {
  id: true,
  status: true,
  amount: true,
  ourReference: true,
  providerReference: true,
  maskedCard: true,
  failureCode: true,
  initiatedAt: true,
  verifiedAt: true,
  provider: { select: { code: true } },
} satisfies Prisma.PaymentTransactionSelect;

export async function orderPayments(client: DbClient, orderId: string) {
  return client.paymentTransaction.findMany({ where: { orderId, kind: "payment" }, orderBy: [{ initiatedAt: "asc" }, { id: "asc" }], select: paymentSelect });
}

export async function attemptCount(tx: Tx, orderId: string): Promise<number> {
  return tx.paymentTransaction.count({ where: { orderId, kind: "payment" } });
}

export async function insertAttempt(tx: Tx, attempt: { orderId: string; providerId: string; amount: bigint; ourReference: string; idempotencyKey: string }): Promise<string> {
  const row = await tx.paymentTransaction.create({ data: { ...attempt, kind: "payment", status: "initiated", currencyCode: "IRR" }, select: { id: true } });
  return row.id;
}

export async function markRedirected(client: DbClient, id: string, providerToken: string): Promise<void> {
  await client.paymentTransaction.updateMany({ where: { id, status: "initiated" }, data: { status: "redirected", providerToken } });
}

const attemptSelect = { id: true, orderId: true, providerId: true, status: true, amount: true, providerToken: true, ourReference: true } satisfies Prisma.PaymentTransactionSelect;

export async function attemptByReference(client: DbClient, providerId: string, ourReference: string) {
  return client.paymentTransaction.findFirst({ where: { providerId, ourReference, kind: "payment" }, select: attemptSelect });
}

/**
 * Claims an attempt for verification: only one callback moves it from
 * redirected to verifying, so a replayed callback can't verify twice.
 */
export async function claimForVerification(client: DbClient | Tx, id: string): Promise<boolean> {
  const { count } = await client.paymentTransaction.updateMany({ where: { id, status: "redirected" }, data: { status: "verifying" } });
  return count === 1;
}

export async function lockAttempt(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payment_transactions WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.paymentTransaction.findUnique({ where: { id }, select: attemptSelect });
}

export async function markSucceeded(tx: Tx, id: string, result: { providerReference: string; maskedCard: string | null; now: Date }): Promise<void> {
  await tx.paymentTransaction.update({ where: { id }, data: { status: "succeeded", providerReference: result.providerReference, maskedCard: result.maskedCard, verifiedAt: result.now } });
}

export async function markFinal(client: DbClient | Tx, id: string, status: Extract<PaymentStatus, "failed" | "cancelled">, failure: { code: string; message: string | null }): Promise<void> {
  await client.paymentTransaction.updateMany({
    where: { id, status: { in: ["initiated", "redirected", "verifying"] } },
    data: { status, failureCode: failure.code.slice(0, 50), failureMessage: failure.message?.slice(0, 500) ?? null },
  });
}

// Callbacks and events -------------------------------------------------------------

export async function logCallback(client: DbClient, entry: { paymentTransactionId: string | null; providerCode: string; payload: Prisma.InputJsonValue; ipAddress: string | null }): Promise<void> {
  await client.paymentCallbackLog.create({ data: entry });
}

export async function insertOutboxEvent(tx: Tx, event: { topic: string; aggregateType: string; aggregateId: string; payload: Prisma.InputJsonValue; dedupeKey: string }): Promise<void> {
  await tx.outboxEvent.create({ data: event });
}
