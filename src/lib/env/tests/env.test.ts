import { describe, expect, it } from "vitest";
import { parseServerEnv } from "../schema";

const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/clicksp" };

describe("parseServerEnv", () => {
  it("applies safe defaults with only a database URL", () => {
    const env = parseServerEnv(base);
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("none");
    expect(env.MEILISEARCH_HOST).toBeUndefined();
  });

  it("rejects a missing or non-PostgreSQL database URL", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://x" })).toThrow(/PostgreSQL/);
  });

  it("does not leak values in error messages", () => {
    try {
      parseServerEnv({ ...base, APP_URL: "not-a-url-secret-value" });
      expect.fail("should throw");
    } catch (e) {
      expect(String(e)).toContain("APP_URL");
      expect(String(e)).not.toContain("secret-value");
    }
  });

  it("refuses the console SMS provider in production", () => {
    expect(() => parseServerEnv({ ...base, APP_ENV: "production", SMS_PROVIDER: "console" })).toThrow();
  });
});
