import "server-only";
import { parseServerEnv, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/** Validated server environment. Throws on first access if it is invalid. */
export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export type { ServerEnv };
