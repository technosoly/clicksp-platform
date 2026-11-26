import { describe, expect, it } from "vitest";
import { parseServerEnv } from "../schema";

const SECRET = "test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz";
const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/clicksp" };

describe("parseServerEnv", () => {
  it("applies safe defaults with only a database URL", () => {
    const env = parseServerEnv(base);
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("none");
    expect(env.MEILISEARCH_HOST).toBeUndefined();
  });

  it("treats empty values as unset (as in .env.example)", () => {
    const env = parseServerEnv({ ...base, S3_ENDPOINT: "", MEILISEARCH_HOST: "", AUTH_SECRET: "", SMS_PROVIDER: "" });
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.SMS_PROVIDER).toBe("none");
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
    expect(() =>
      parseServerEnv({ ...base, APP_ENV: "production", AUTH_SECRET: SECRET, SMS_PROVIDER: "console" }),
    ).toThrow(/SMS_PROVIDER/);
  });

  it("keeps AUTH_SECRET optional in development but requires it in production", () => {
    expect(parseServerEnv(base).AUTH_SECRET).toBeUndefined();
    expect(() => parseServerEnv({ ...base, APP_ENV: "production" })).toThrow(/AUTH_SECRET/);
    expect(parseServerEnv({ ...base, APP_ENV: "production", AUTH_SECRET: SECRET }).AUTH_SECRET).toBe(SECRET);
  });

  it("rejects a short AUTH_SECRET without echoing it", () => {
    try {
      parseServerEnv({ ...base, AUTH_SECRET: "short-secret-value" });
      expect.fail("should throw");
    } catch (e) {
      expect(String(e)).toContain("AUTH_SECRET");
      expect(String(e)).not.toContain("short-secret-value");
    }
  });
});
