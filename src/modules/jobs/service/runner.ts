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

let running: PgBoss | null = null;

export async function startJobRunner(): Promise<void> {
  if (running || !env().JOBS_ENABLED) return;
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", application_name: "clicksp-jobs", max: 4 });
  boss.on("error", (error) => logger.error("job runner error", { error: String(error) }));
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
  running = boss;
  logger.info("job runner started", { jobs: JOBS.map((j) => j.name) });
  // First start with a search engine: build the index now instead of waiting for the night.
  if (await productIndexMissing().catch(() => false)) await boss.send("search-rebuild", null);
}

export async function stopJobRunner(): Promise<void> {
  const boss = running;
  running = null;
  await boss?.stop({ graceful: true, timeout: 8_000 });
}
