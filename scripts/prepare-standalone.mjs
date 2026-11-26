// Copies static assets next to the standalone server, as `next build` with
// output: "standalone" does not include them. Used by `pnpm start` and E2E.
import { cpSync, existsSync } from "node:fs";

if (!existsSync(".next/standalone/server.js")) {
  console.error("Run `pnpm build` first: .next/standalone/server.js is missing.");
  process.exit(1);
}
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
