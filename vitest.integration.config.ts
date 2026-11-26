import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real PostgreSQL database (constraints,
 * triggers, seed, concurrency, and the auth/RBAC services end to end).
 * Run with `pnpm test:integration`.
 * TEST_DATABASE_URL must point at a disposable database: global setup drops
 * and recreates its public schema, applies all migrations and the seed.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
    // Files share one database; run them one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
