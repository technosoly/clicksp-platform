import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { expireUnpaidOrders } from "@/modules/sales/service/checkout";
import { productIndexMissing, rebuildProductIndex } from "@/modules/search/service/product-search";
import { OUTBOX_HANDLERS } from "./handlers";
import { dispatchOutbox } from "./outbox";

/**
 * Background jobs, run by pg-boss (12.40, https://pgboss.io) in the app's own
 * PostgreSQL database (schema `pgboss`). Every app process starts the runner;
 * pg-boss sends each scheduled job once however many processes run, and the
 * queues are `stately`, so a slow run never piles up copies of itself.
 * Times are Tehran time. JOBS_ENABLED=false turns the runner off (tests).
 */

interface JobSpec {
  name: string;
  cron: string;
  expireInSeconds: number;
  run: () => Promise<unknown>;
}

export const JOBS: readonly JobSpec[] = [
  // Delivers outbox events to the modules that handle them.
  { name: "outbox-dispatch", cron: "* * * * *", expireInSeconds: 300, run: () => dispatchOutbox(OUTBOX_HANDLERS) },
  // Releases the stock held by orders whose payment window has passed (checkout also does this as it goes).
  { name: "orders-expire", cron: "*/5 * * * *", expireInSeconds: 300, run: () => expireUnpaidOrders(new Date(), 200) },
  // Rebuilds the search index from the database every night, when a search engine is set up.
  { name: "search-rebuild", cron: "30 3 * * *", expireInSeconds: 3600, run: () => rebuildProductIndex() },
];

type RunnerState = "off" | "starting" | "running" | "retrying";
// Kept on globalThis: Next.js loads instrumentation.ts and the route handlers
// as separate bundles, each with its own copy of this module.
const shared = globalThis as typeof globalThis & { __clickspJobs?: { boss: PgBoss | null; state: RunnerState; retryTimer: ReturnType<typeof setTimeout> | null } };
const runner = (shared.__clickspJobs ??= { boss: null, state: "off", retryTimer: null });

/** For the health endpoint: whether background jobs are running in this process. */
export const jobRunnerState = (): RunnerState => runner.state;

async function startOnce(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", application_name: "clicksp-jobs", max: 4 });
  boss.on("error", (error) => logger.error("job runner error", { error: String(error) }));
  try {
    await boss.start();
    for (const job of JOBS) {
      await boss.createQueue(job.name, { policy: "stately", retryLimit: 2, retryDelay: 30, expireInSeconds: job.expireInSeconds });
      await boss.schedule(job.name, job.cron, null, { tz: "Asia/Tehran" });
      await boss.work(job.name, async () => {
        const started = Date.now();
        const result = await job.run();
        logger.debug("job finished", { job: job.name, ms: Date.now() - started, result: result ?? null });
      });
    }
    return boss;
  } catch (error) {
    // Nothing half-started is left running: its pool and workers are closed before a retry.
    await boss.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined);
    throw error;
  }
}

/**
 * Starts the runner. If the database isn't reachable yet it keeps trying in
 * the background (1 minute, doubling to 10 minutes) instead of giving up
 * until the next restart; the site serves meanwhile.
 */
export async function startJobRunner(attempt = 0): Promise<void> {
  if (runner.boss || !env().JOBS_ENABLED) return;
  runner.state = attempt === 0 ? "starting" : "retrying";
  let boss: PgBoss;
  try {
    boss = await startOnce();
  } catch (error) {
    const delay = Math.min(60_000 * 2 ** attempt, 10 * 60_000);
    runner.state = "retrying";
    logger.error("job runner did not start; retrying", { error: String(error), retryInSeconds: delay / 1000 });
    runner.retryTimer = setTimeout(() => void startJobRunner(attempt + 1), delay);
    runner.retryTimer.unref();
    return;
  }
  runner.boss = boss;
  runner.state = "running";
  logger.info("job runner started", { jobs: JOBS.map((j) => j.name) });
  // First start with a search engine: build the index now instead of waiting
  // for the night. Not awaited, so a slow search engine never delays start-up.
  void productIndexMissing()
    .then((missing) => (missing ? boss.send("search-rebuild", null) : null))
    .catch((error) => logger.warn("could not check the search index", { error: String(error) }));
}

/** Stops taking new jobs and lets running ones finish (up to 8 seconds). */
export async function stopJobRunner(): Promise<void> {
  if (runner.retryTimer) clearTimeout(runner.retryTimer);
  const boss = runner.boss;
  runner.boss = null;
  runner.state = "off";
  await boss?.stop({ graceful: true, timeout: 8_000 });
}
