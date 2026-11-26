/**
 * Random tokens, codes and hashes for authentication. Uses node:crypto only.
 * Raw tokens are given to the browser (cookie) or the user (SMS); the
 * database only ever stores their SHA-256 / HMAC-SHA-256 hex digests.
 *
 * Erasable TypeScript only: also imported by CLI scripts run with Node's
 * type stripping.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** URL-safe random token with `bytes` bytes of entropy (default 32 = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Uniformly random numeric code, zero-padded (e.g. SMS OTP). */
export function randomNumericCode(digits = 6): string {
  if (!Number.isInteger(digits) || digits < 4 || digits > 10) throw new Error("digits must be 4..10");
  return String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

/** Lower-case hex SHA-256 (64 chars), the format the database CHECKs expect. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Lower-case hex HMAC-SHA-256 with a server secret. */
export function hmacSha256Hex(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
