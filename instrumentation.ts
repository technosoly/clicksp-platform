/**
 * Runs once when a Next.js server starts (https://nextjs.org/docs/app/guides/instrumentation):
 * starts the background job runner in the Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner, stopJobRunner } = await import("@/modules/jobs/service/runner");
    try {
      await startJobRunner();
    } catch (error) {
      // The site keeps serving; the jobs catch up once the runner starts on the next deploy or restart.
      const { logger } = await import("@/lib/logger");
      logger.error("job runner did not start", { error: String(error) });
    }
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void stopJobRunner().finally(() => process.exit(0)));
  }
}
