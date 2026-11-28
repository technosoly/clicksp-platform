import { describe, expect, it } from "vitest";
import { decryptString, deriveKey, encryptString } from "../encryption";
import { checkPasswordPolicy, hashPassword, verifyPassword, verifyPasswordAgainstDummy } from "../password";
import { base32Decode, base32Encode, findTotpDrift, generateTotpSecret, hotp, totp, totpUri, verifyTotp } from "../totp";
import { randomNumericCode, randomToken, safeEqual, sha256Hex } from "../tokens";

// RFC 6238 Appendix B secret (ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("tokens", () => {
  it("creates URL-safe tokens with the requested entropy", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it("creates zero-padded numeric codes", () => {
    for (let i = 0; i < 50; i += 1) expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(() => randomNumericCode(2)).toThrow();
  });

  it("hashes to 64 lower-case hex chars (the database CHECK format)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compares in constant time and handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("TOTP (RFC 6238 / RFC 4226)", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const key = Buffer.from("12345678901234567890", "ascii");
    expect(hotp(key, 0)).toBe("755224");
    expect(hotp(key, 1)).toBe("287082");
    expect(hotp(key, 9)).toBe("520489");
  });

  it("matches the RFC 6238 SHA-1 vectors (8 digits)", () => {
    expect(totp(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totp(RFC_SECRET, 1_111_111_109_000, 8)).toBe("07081804");
    expect(totp(RFC_SECRET, 20_000_000_000_000, 8)).toBe("65353130");
  });

  it("round-trips base32", () => {
    const data = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts the current step and one step of drift, nothing more", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });

  it("refuses a replay of the same or an older code", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = verifyTotp(secret, totp(secret, now), now);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now), now, step)).toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 30_000), now, step)).toBeNull();
  });

  it("finds clock drift outside the accepted window without accepting the code", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    // Phone 5 minutes ahead of the server: refused, drift = +10 steps.
    const ahead = totp(secret, now + 5 * 60_000);
    expect(verifyTotp(secret, ahead, now)).toBeNull();
    expect(findTotpDrift(secret, ahead, now)).toBe(10);
    // Phone 3 minutes behind.
    expect(findTotpDrift(secret, totp(secret, now - 3 * 60_000), now)).toBe(-6);
    // Codes inside the normal window are not drift.
    expect(findTotpDrift(secret, totp(secret, now), now)).toBeNull();
    expect(findTotpDrift(secret, totp(secret, now + 30_000), now)).toBeNull();
    // Further than 10 minutes, or not a code at all.
    expect(findTotpDrift(secret, totp(secret, now + 30 * 60_000), now)).toBeNull();
    expect(findTotpDrift(secret, "abcdef", now)).toBeNull();
    // An already used (replayed) code is not drift.
    const used = verifyTotp(secret, totp(secret, now), now)!;
    expect(findTotpDrift(secret, totp(secret, now - 3 * 60_000), now, used)).toBeNull();
  });

  it("builds an otpauth URI", () => {
    const uri = totpUri("ABC", "owner", "Clicksp");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Clicksp%3Aowner\?secret=ABC&issuer=Clicksp/);
  });
});

describe("encryption", () => {
  const key = deriveKey("x".repeat(40), "totp");

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptString(key, "secret", "user-1");
    const b = encryptString(key, "secret", "user-1");
    expect(a).not.toBe(b);
    expect(decryptString(key, a, "user-1")).toBe("secret");
  });

  it("detects tampering, a wrong key and a wrong context", () => {
    const value = encryptString(key, "secret", "user-1");
    const parts = value.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("other!").toString("base64url")].join(".");
    expect(() => decryptString(key, tampered, "user-1")).toThrow();
    expect(() => decryptString(deriveKey("y".repeat(40), "totp"), value, "user-1")).toThrow();
    expect(() => decryptString(deriveKey("x".repeat(40), "other"), value, "user-1")).toThrow();
    expect(() => decryptString(key, value, "user-2")).toThrow();
  });

  it("refuses a short secret", () => {
    expect(() => deriveKey("short", "totp")).toThrow();
  });
});

describe("passwords", () => {
  it("enforces length, not composition", () => {
    expect(checkPasswordPolicy("short")).toBe("too_short");
    expect(checkPasswordPolicy("a".repeat(129))).toBe("too_long");
    expect(checkPasswordPolicy("correct horse battery")).toBeNull();
    expect(checkPasswordPolicy("رمز عبور بلند و امن")).toBeNull();
    expect(checkPasswordPolicy("OwnerAccount1", ["owneraccount1"])).toBe("same_as_identifier");
  });

  it("hashes with Argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(await verifyPasswordAgainstDummy("x")).toBe(false);
  });
});
