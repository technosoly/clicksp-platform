import { isIP } from "node:net";

/** Who is calling, for audit logs, security events and rate limits. */
export interface RequestMeta {
  /** Client IP from the trusted proxy header; null when absent or invalid (rate limits then use a shared "unknown" bucket). */
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const EMPTY_REQUEST_META: RequestMeta = { ipAddress: null, userAgent: null, requestId: null };

interface HeaderReader {
  get(name: string): string | null;
}

export type TrustedIpHeader = "x-real-ip" | "x-forwarded-for";

/**
 * Reads the client IP, user agent and request id from request headers.
 * Only ONE header is trusted for the IP: the one the reverse proxy in front
 * of the app sets (TRUSTED_IP_HEADER, default X-Real-IP; docs/DEPLOYMENT.md).
 * For X-Forwarded-For the last entry is used, which is the one the proxy
 * appended (earlier entries come from the client). There is no fallback to
 * another header, and anything that is not a valid IP becomes null.
 */
export function requestMetaFromHeaders(headers: HeaderReader, trustedIpHeader: TrustedIpHeader = "x-real-ip"): RequestMeta {
  const raw = headers.get(trustedIpHeader);
  const candidate = trustedIpHeader === "x-forwarded-for" ? raw?.split(",").at(-1)?.trim() : raw?.trim();
  const ipAddress = candidate && isIP(candidate) ? candidate : null;
  const userAgent = headers.get("user-agent")?.slice(0, 500) || null;
  const rawId = headers.get("x-request-id");
  const requestId = rawId && /^[A-Za-z0-9._-]{1,64}$/.test(rawId) ? rawId : null;
  return { ipAddress, userAgent, requestId };
}
