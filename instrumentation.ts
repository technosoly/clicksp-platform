/**
 * Runs once when a Next.js server starts (https://nextjs.org/docs/app/guides/instrumentation):
 * starts the background job runner in the Node.js runtime. Next.js handles
 * shutdown itself; on SIGTERM/SIGINT the runner only stops taking new jobs
 * (a job cut short is retried by pg-boss on the next start).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner, stopJobRunner } = await import("@/modules/jobs/service/runner");
    await startJobRunner();
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void stopJobRunner());
  }
}
