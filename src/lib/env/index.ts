import "server-only";
import { parseServerEnv, type ServerEnv } from "./schema";

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

export type { ServerEnv };
