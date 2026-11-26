import { describe, expect, it } from "vitest";
import { redact } from "../service/audit";

describe("redact", () => {
  it("removes secret-looking values at any depth", () => {
    expect(
      redact({ username: "owner", password: "p", nested: { totpSecret: "s", list: [{ backupCodeHashes: ["x"] }] }, otp: "1" }),
    ).toEqual({
      username: "owner",
      password: "[redacted]",
      nested: { totpSecret: "[redacted]", list: [{ backupCodeHashes: "[redacted]" }] },
      otp: "[redacted]",
    });
  });

  it("leaves other values alone", () => {
    expect(redact(["a", 1, null])).toEqual(["a", 1, null]);
  });
});
