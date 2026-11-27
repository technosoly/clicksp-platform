/** Database access for delivering outbox events (`outbox_events`). */
import type { DbClient } from "@/lib/db";
import type { OutboxEvent } from "../domain/outbox";

/**
 * Claims up to `take` events of these topics that are due, oldest first. A
 * claimed event is leased until `leaseUntil`; if its runner dies the lease
 * runs out and another runner takes it over. Concurrent runners skip rows
 * another one holds, so an event is never handled by two at once.
 */
export async function claimOutboxEvents(client: DbClient, topics: readonly string[], take: number, now: Date, leaseUntil: Date): Promise<OutboxEvent[]> {
  if (topics.length === 0) return [];
  const rows = await client.$queryRaw<{ id: string; seq: bigint; topic: string; aggregate_type: string; aggregate_id: string; payload: unknown; attempts: number }[]>`
    UPDATE outbox_events o
       SET status = 'processing', attempts = o.attempts + 1, available_at = ${leaseUntil}
      FROM (
        SELECT id FROM outbox_events
         WHERE status IN ('pending', 'processing') AND available_at <= ${now} AND topic = ANY(${[...topics]}::text[])
         ORDER BY seq
         LIMIT ${take}
         FOR UPDATE SKIP LOCKED
      ) due
     WHERE o.id = due.id
    RETURNING o.id, o.seq, o.topic, o.aggregate_type, o.aggregate_id::text, o.payload, o.attempts`;
  return rows
    .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
    .map((r) => ({ id: r.id, topic: r.topic, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, payload: r.payload, attempts: r.attempts }));
}

/*
 * The mark functions only touch the event while this runner's claim still
 * holds: same status and the same attempt number. A runner whose lease ran
 * out (and whose event another runner has claimed since) changes nothing.
 */

export async function markOutboxDone(client: DbClient, claim: { id: string; attempts: number }, now: Date): Promise<void> {
  await client.outboxEvent.updateMany({ where: { id: claim.id, attempts: claim.attempts, status: "processing" }, data: { status: "done", processedAt: now, lastError: null } });
}

export async function markOutboxRetry(client: DbClient, claim: { id: string; attempts: number }, availableAt: Date, error: string): Promise<void> {
  await client.outboxEvent.updateMany({ where: { id: claim.id, attempts: claim.attempts, status: "processing" }, data: { status: "pending", availableAt, lastError: error.slice(0, 2000) } });
}

export async function markOutboxFailed(client: DbClient, claim: { id: string; attempts: number }, error: string): Promise<void> {
  await client.outboxEvent.updateMany({ where: { id: claim.id, attempts: claim.attempts, status: "processing" }, data: { status: "failed", lastError: error.slice(0, 2000) } });
}

/** Events of these topics that failed at least once and aren't done (waiting to retry, or parked as failed). */
export async function troubledEvents(client: DbClient, topics: readonly string[], take: number) {
  const where = { topic: { in: [...topics] }, status: { in: ["pending", "failed"] as ("pending" | "failed")[] }, attempts: { gt: 0 } };
  const [rows, total] = await Promise.all([
    client.outboxEvent.findMany({ where, orderBy: { seq: "asc" }, take, select: { id: true, topic: true, aggregateId: true, status: true, attempts: true, lastError: true, createdAt: true } }),
    client.outboxEvent.count({ where }),
  ]);
  return { rows, total };
}

/** Events of these topics not handled yet (waiting, being handled or stopped). */
export async function unfinishedEventCount(client: DbClient, topics: readonly string[]): Promise<number> {
  return client.outboxEvent.count({ where: { topic: { in: [...topics] }, status: { in: ["pending", "processing", "failed"] } } });
}

/** Puts failed or waiting events of these topics back in line now, with a fresh count of attempts. */
export async function requeueEvents(client: DbClient, topics: readonly string[], now: Date): Promise<number> {
  const { count } = await client.outboxEvent.updateMany({
    where: { topic: { in: [...topics] }, status: { in: ["pending", "failed"] }, attempts: { gt: 0 } },
    data: { status: "pending", attempts: 0, availableAt: now },
  });
  return count;
}
