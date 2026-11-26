import { z } from "zod";

/**
 * Server-side environment schema. Values are validated once at startup.
 * Only variables listed here may be read by application code.
 * Optional integrations (SMS, payments, S3, search) stay optional so the
 * site builds and runs without them; each adapter checks its own config.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    }),

  /**
   * Server secret for authentication: encrypts TOTP secrets and keys the OTP
   * hashes. At least 32 characters; generate with `openssl rand -base64 48`.
   * Optional so the storefront builds and runs without it; sign-in refuses to
   * work until it is set, and production refuses to start without it.
   */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),

  REDIS_URL: z.string().optional(),

  MEILISEARCH_HOST: z.url().optional(),
  MEILISEARCH_API_KEY: z.string().optional(),

  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Pluggable providers, chosen later by the owner. "none" keeps them disabled.
  SMS_PROVIDER: z.enum(["none", "console"]).default("none"),
  PAYMENT_PROVIDERS: z.string().default(""),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // An empty value (e.g. `S3_ENDPOINT=` copied from .env.example) means "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = serverEnvSchema.safeParse(cleaned);
  if (!result.success) {
    // List only the variable names and problems, never the values.
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }
  if (result.data.APP_ENV === "production" && result.data.SMS_PROVIDER === "console") {
    throw new Error("Invalid server environment: SMS_PROVIDER=console is not allowed in production");
  }
  if (result.data.APP_ENV === "production" && !result.data.AUTH_SECRET) {
    throw new Error("Invalid server environment: AUTH_SECRET is required in production");
  }
  return result.data;
}
