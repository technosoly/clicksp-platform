import { describe, expect, it } from "vitest";
import { requestMetaFromHeaders } from "../request-meta";

const h = (values: Record<string, string>) => new Headers(values);

describe("requestMetaFromHeaders", () => {
  it("reads only the trusted header (X-Real-IP by default)", () => {
    expect(requestMetaFromHeaders(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).ipAddress).toBe("203.0.113.7");
    expect(requestMetaFromHeaders(h({ "x-real-ip": "2001:db8::1" })).ipAddress).toBe("2001:db8::1");
    // No fallback to X-Forwarded-For, which a client can set.
    expect(requestMetaFromHeaders(h({ "x-forwarded-for": "198.51.100.1" })).ipAddress).toBeNull();
    expect(requestMetaFromHeaders(h({ "x-real-ip": "x", "x-forwarded-for": "198.51.100.1" })).ipAddress).toBeNull();
  });

  it("uses the last X-Forwarded-For entry (added by the proxy) when that header is trusted", () => {
    expect(requestMetaFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" }), "x-forwarded-for").ipAddress).toBe("198.51.100.9");
    expect(requestMetaFromHeaders(h({ "x-real-ip": "203.0.113.7" }), "x-forwarded-for").ipAddress).toBeNull();
  });

  it("drops values that are not IP addresses or safe request ids", () => {
    const meta = requestMetaFromHeaders(h({ "x-real-ip": "'; DROP TABLE users;--", "x-request-id": "<script>" }));
    expect(meta.ipAddress).toBeNull();
    expect(meta.requestId).toBeNull();
  });

  it("truncates long user agents", () => {
    expect(requestMetaFromHeaders(h({ "user-agent": "a".repeat(900) })).userAgent).toHaveLength(500);
  });
});
