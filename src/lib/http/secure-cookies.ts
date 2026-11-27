import "server-only";
import { env } from "@/lib/env";

/** Cookies are Secure on HTTPS, and always in production (whatever APP_URL says). */
export function cookiesAreSecure(): boolean {
  return env().APP_URL.startsWith("https://") || env().APP_ENV === "production" || process.env.NODE_ENV === "production";
}
