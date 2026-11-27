import { jobRunnerState } from "@/modules/jobs/service/runner";

// Liveness probe: the process is up and serving. No dependencies checked;
// `jobs` says whether background jobs run in this process (off, starting,
// running, retrying) without making the probe fail.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", jobs: jobRunnerState() }, { headers: { "Cache-Control": "no-store" } });
}
