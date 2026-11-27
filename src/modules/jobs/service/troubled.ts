import "server-only";
import { db, type DbClient } from "@/lib/db";
import { requeueEvents, troubledEvents, unfinishedEventCount } from "../repo/outbox-repo";

/**
 * Outbox events a module couldn't handle yet (for example accounting
 * postings before the posting accounts were chosen). The calling module
 * authorizes its own screen and button.
 */
export async function troubledOutboxEvents(topics: readonly string[], take = 20) {
  return troubledEvents(db(), topics, take);
}

/** Tries them again on the next run of the outbox job. */
export async function retryOutboxEvents(topics: readonly string[], now = new Date(), client: DbClient = db()): Promise<number> {
  return requeueEvents(client, topics, now);
}

/** How many events of these topics are not handled yet (in the caller's transaction if given). */
export async function unfinishedOutboxEvents(topics: readonly string[], client: DbClient = db()): Promise<number> {
  return unfinishedEventCount(client, topics);
}
