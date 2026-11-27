import "server-only";
import { parseServerEnv, paymentAdapterKeys, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/** Validated server environment. Throws on first access if it is invalid. */
export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** AUTH_SECRET, or a clear error when sign-in is used without it. */
export function authSecret(): string {
  const secret = env().AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set. Add it to .env (see .env.example).");
  return secret;
}

/** The payment gateway adapters this server may use (PAYMENT_PROVIDERS). */
export function enabledPaymentAdapters(): string[] {
  return paymentAdapterKeys(env().PAYMENT_PROVIDERS);
}

/**
 * A gateway credential, read from `<PREFIX>_<NAME>` (the provider row names
 * the prefix, e.g. ZARINPAL_MERCHANT_ID). Secrets live only in the server
 * environment, never in the database or the browser. Null when unset.
 */
export function providerSecret(prefix: string, name: string): string | null {
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(prefix) || !/^[A-Z][A-Z0-9_]{1,40}$/.test(name)) return null;
  const value = process.env[`${prefix}_${name}`];
  return value ? value : null;
}

export type { ServerEnv };
