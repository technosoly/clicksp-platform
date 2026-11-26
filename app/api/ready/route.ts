import { pingDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";

// Readiness probe: the app can reach its database. Used by Docker health
// checks and the reverse proxy before sending traffic.
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await pingDatabase();
  if (!database) logger.warn("readiness check failed", { check: "database" });
  return Response.json(
    { status: database ? "ready" : "not_ready", checks: { database: database ? "ok" : "fail" } },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
