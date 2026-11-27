/**
 * Delivering outbox events. Business code writes an event in the same
 * transaction as its change; the job runner later hands each event to the
 * handler registered for its topic. Handlers must be idempotent: an event can
 * be delivered more than once (a crash between handling and marking it done),
 * and they re-read current state instead of trusting the payload.
 */

export interface OutboxEvent {
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  /** Delivery attempts so far, this one included. */
  attempts: number;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/** After this many failed attempts an event is parked as failed for a person to look at. */
export const MAX_OUTBOX_ATTEMPTS = 10;
/** How long a claimed event is held before another runner may take it over (a runner that died). */
export const OUTBOX_LEASE_MS = 5 * 60_000;

/** Wait before the next attempt: 30 s, 1 min, 2 min ... capped at 1 hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}
