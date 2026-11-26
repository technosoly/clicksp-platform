import { describe, expect, it } from "vitest";
import { requestMetaFromHeaders } from "../request-meta";

const h = (values: Record<string, string>) => new Headers(values);

describe("requestMetaFromHeaders", () => {
  it("prefers X-Real-IP, then the first X-Forwarded-For entry", () => {
    expect(requestMetaFromHeaders(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).ipAddress).toBe(
      "203.0.113.7",
    );
    expect(requestMetaFromHeaders(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })).ipAddress).toBe("198.51.100.1");
    expect(requestMetaFromHeaders(h({ "x-forwarded-for": "2001:db8::1" })).ipAddress).toBe("2001:db8::1");
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
