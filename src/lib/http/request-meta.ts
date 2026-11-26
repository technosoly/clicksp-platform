import { isIP } from "node:net";

/** Who is calling, for audit logs, security events and rate limits. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const EMPTY_REQUEST_META: RequestMeta = { ipAddress: null, userAgent: null, requestId: null };

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Reads the client IP, user agent and request id from request headers.
 * The client IP comes from X-Real-IP or the first X-Forwarded-For entry, which
 * only the reverse proxy in front of the app may set (docs/DEPLOYMENT.md);
 * anything that is not a valid IP address is dropped.
 */
export function requestMetaFromHeaders(headers: HeaderReader): RequestMeta {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = headers.get("x-real-ip")?.trim() || forwarded || null;
  const ipAddress = candidate && isIP(candidate) ? candidate : null;
  const userAgent = headers.get("user-agent")?.slice(0, 500) || null;
  const rawId = headers.get("x-request-id");
  const requestId = rawId && /^[A-Za-z0-9._-]{1,64}$/.test(rawId) ? rawId : null;
  return { ipAddress, userAgent, requestId };
}
