/**
 * Environment for integration tests that call application services: they use
 * the app's Prisma client (DATABASE_URL), so point it at the test database.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "integration-test-only-secret-0123456789abcdefghijklmnop";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SMS_PROVIDER = "none";
