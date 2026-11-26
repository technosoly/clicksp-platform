import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    // System data only (locales, IRR, permissions, roles, settings); idempotent.
    seed: "node prisma/seed.ts",
  },
  datasource: {
    // Read lazily so `prisma generate` works without a database (e.g. in CI builds).
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
