import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MAX_OUTBOX_ATTEMPTS, OUTBOX_LEASE_MS, retryDelayMs, type OutboxHandler } from "../domain/outbox";
import { claimOutboxEvents, markOutboxDone, markOutboxFailed, markOutboxRetry } from "../repo/outbox-repo";

/**
 * Delivers due outbox events to their handlers, a batch at a time. Only
 * topics with a handler are claimed: events no module consumes yet (order
 * messages before an SMS provider exists, for example) stay pending and are
 * delivered once a handler is added. A handler that throws is retried later
 * with a growing delay; after MAX_OUTBOX_ATTEMPTS the event is parked as
 * failed with its last error. Returns how many events were handled.
 */
export async function dispatchOutbox(handlers: ReadonlyMap<string, OutboxHandler>, options: { now?: () => Date; batch?: number; maxBatches?: number } = {}): Promise<{ done: number; retried: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const counts = { done: 0, retried: 0, failed: 0 };
  for (let round = 0; round < (options.maxBatches ?? 10); round++) {
    const at = now();
    const events = await claimOutboxEvents(db(), [...handlers.keys()], options.batch ?? 50, at, new Date(at.getTime() + OUTBOX_LEASE_MS));
    if (events.length === 0) break;
    for (const event of events) {
      try {
        await handlers.get(event.topic)!(event);
        await markOutboxDone(db(), event.id, now());
        counts.done++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (event.attempts >= MAX_OUTBOX_ATTEMPTS) {
          await markOutboxFailed(db(), event.id, message);
          logger.error("outbox event failed for good", { id: event.id, topic: event.topic, error: message });
          counts.failed++;
        } else {
          await markOutboxRetry(db(), event.id, new Date(now().getTime() + retryDelayMs(event.attempts)), message);
          logger.warn("outbox event will be retried", { id: event.id, topic: event.topic, attempts: event.attempts, error: message });
          counts.retried++;
        }
      }
    }
  }
  return counts;
}
