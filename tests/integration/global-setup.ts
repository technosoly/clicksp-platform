import { execFileSync } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { BUSINESS_TABLES } from "./business-tables";
import { seedSystemData } from "../../prisma/seed/system-seed";

/**
 * Recreates the test database schema from the migrations (exactly as a
 * deploy would), checks the Prisma schema has no drift against them, and runs
 * the system seed once.
 */
export default async function setup(project: TestProject): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Point it at a disposable PostgreSQL database.");
  }
  if (/production|prod\b/i.test(url)) {
    throw new Error("Refusing to run integration tests against a database that looks like production.");
  }

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
    await admin.query("CREATE SCHEMA public");
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "pipe" });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await seedSystemData(client);
    const counts: Record<string, number> = {};
    for (const table of BUSINESS_TABLES) {
      const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      counts[table] = Number(rows[0]?.n);
    }
    project.provide("businessRowCountsAfterSeed", counts);
  } finally {
    await client.end();
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    businessRowCountsAfterSeed: Record<string, number>;
  }
}
