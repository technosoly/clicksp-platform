/**
 * Environment for integration tests that call application services: they use
 * the app's Prisma client (DATABASE_URL), so point it at the test database.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "integration-test-only-secret-0123456789abcdefghijklmnop";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SMS_PROVIDER = "none";
// The stand-in payment gateway (never allowed in production).
process.env.PAYMENT_PROVIDERS = "fake";
// Uploaded images go to a throwaway folder.
process.env.MEDIA_STORAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/clicksp-test-media`;
// Search engine tests run when a Meilisearch for tests is given (CI runs one); otherwise the database search answers.
if (process.env.TEST_MEILISEARCH_HOST) {
  process.env.MEILISEARCH_HOST = process.env.TEST_MEILISEARCH_HOST;
  process.env.MEILISEARCH_API_KEY = process.env.TEST_MEILISEARCH_API_KEY ?? "";
} else {
  delete process.env.MEILISEARCH_HOST;
  delete process.env.MEILISEARCH_API_KEY;
}
