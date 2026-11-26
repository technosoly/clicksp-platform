/**
 * CLI entry for the system seed: `pnpm db:seed` (also run by `prisma db seed`
 * and the Docker migrate job after `prisma migrate deploy`).
 * Reads DATABASE_URL from the environment (or .env in development).
 */
import "dotenv/config";
import pg from "pg";
import { seedSystemData } from "./seed/system-seed.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const report = await seedSystemData(client);
  console.log(JSON.stringify({ level: "info", msg: "system seed complete", ...report }));
} finally {
  await client.end();
}
