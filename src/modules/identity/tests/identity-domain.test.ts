import { describe, expect, it } from "vitest";
import { maskPhone, normalizeIranianMobile } from "../domain/phone";
import {
  DEFAULT_SECURITY_POLICY as P,
  isMfaFresh,
  isMfaRequired,
  sessionExpiry,
  sessionState,
} from "../domain/policy";
import { createSmsSender, disabledSmsSender, SmsNotConfiguredError } from "../sms/sms-adapter";
import { PERMISSIONS, SYSTEM_ROLES, defaultGrants } from "@/modules/rbac/domain/permission-catalogue";

describe("normalizeIranianMobile", () => {
  it.each([
    ["09121234567", "+989121234567"],
    ["9121234567", "+989121234567"],
    ["+98 912 123 4567", "+989121234567"],
    ["0098-912-123-4567", "+989121234567"],
    ["989121234567", "+989121234567"],
    ["۰۹۱۲۱۲۳۴۵۶۷", "+989121234567"],
    ["٠٩١٢١٢٣٤٥٦٧", "+989121234567"],
    ["(0912) 123 4567", "+989121234567"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeIranianMobile(input)).toBe(expected);
  });

  it.each(["02112345678", "0912123456", "091212345678", "+447700900123", "abc", "", "0812 123 4567"])(
    "rejects %s",
    (input) => {
      expect(normalizeIranianMobile(input)).toBeNull();
    },
  );

  it("masks numbers for logs", () => {
    expect(maskPhone("+989121234567")).toBe("+98912***4567");
  });
});

describe("MFA requirement", () => {
  it("is required for levels 1 and 2", () => {
    expect(isMfaRequired(1, [], P)).toBe(true);
    expect(isMfaRequired(2, [], P)).toBe(true);
    expect(isMfaRequired(3, ["product.view"], P)).toBe(false);
  });

  it("is required for Store Staff with any pricing or financial permission", () => {
    expect(isMfaRequired(3, ["product.view", "price.update.propose"], P)).toBe(true);
    expect(isMfaRequired(3, ["accounting.view"], P)).toBe(true);
    expect(isMfaRequired(3, ["inventory.view_cost"], P)).toBe(true);
  });

  it("is required for the default Store Staff bundle (it can propose price changes)", () => {
    const staff = SYSTEM_ROLES.find((r) => r.key === "store_staff")!;
    expect(isMfaRequired(3, defaultGrants(staff).map((g) => g.key), P)).toBe(true);
  });

  it("covers every catalogue permission that touches money", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    for (const key of ["price.update", "refund.create", "accounting.post", "report.financial", "order.view_payment"]) {
      expect(keys).toContain(key);
      expect(isMfaRequired(3, [key], P)).toBe(true);
    }
  });

  it("treats a check as fresh for the step-up window only", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isMfaFresh(null, now, P)).toBe(false);
    expect(isMfaFresh(new Date(now.getTime() - 299_000), now, P)).toBe(true);
    expect(isMfaFresh(new Date(now.getTime() - 301_000), now, P)).toBe(false);
  });
});

describe("session lifetimes", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it("gives pending admin sessions 10 minutes, full admin sessions 12 hours, customers 30 days", () => {
    expect(sessionExpiry("admin", true, now, P)).toEqual(at(10));
    expect(sessionExpiry("admin", false, now, P)).toEqual(at(12 * 60));
    expect(sessionExpiry("customer", false, now, P)).toEqual(at(30 * 24 * 60));
  });

  it("expires admin sessions after 30 idle minutes", () => {
    const s = { createdAt: now, lastSeenAt: now, expiresAt: at(720), revokedAt: null };
    expect(sessionState("admin", s, at(29), P)).toBe("active");
    expect(sessionState("admin", s, at(30), P)).toBe("idle");
    expect(sessionState("customer", s, at(30), P)).toBe("active");
    expect(sessionState("admin", { ...s, lastSeenAt: at(719) }, at(720), P)).toBe("expired");
    expect(sessionState("admin", { ...s, revokedAt: at(1) }, at(2), P)).toBe("revoked");
  });
});

describe("SMS adapters", () => {
  it("refuses to send without a provider", async () => {
    expect(disabledSmsSender.enabled).toBe(false);
    await expect(disabledSmsSender.send({ to: "+989121234567", text: "x", purpose: "otp" })).rejects.toBeInstanceOf(
      SmsNotConfiguredError,
    );
  });

  it("never allows the console provider in production", () => {
    expect(() => createSmsSender({ provider: "console", nodeEnv: "production", appEnv: "development" })).toThrow();
    expect(() => createSmsSender({ provider: "console", nodeEnv: "development", appEnv: "production" })).toThrow();
    expect(createSmsSender({ provider: "console", nodeEnv: "development", appEnv: "development" }).enabled).toBe(true);
    expect(createSmsSender({ provider: "none", nodeEnv: "production", appEnv: "production" }).enabled).toBe(false);
  });
});
