/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30-second steps), compatible with
 * Google Authenticator, Microsoft Authenticator, Aegis and similar apps.
 * Implemented on node:crypto to avoid a dependency for ~60 lines of code.
 */
import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./tokens.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random 160-bit secret, base32 encoded (the length RFC 4226 recommends). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP value for a counter (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, timeMs: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), totpStep(timeMs), digits);
}

/**
 * Checks a code against the current step and one step either side (clock
 * drift). Returns the matched step, so the caller can store it and refuse a
 * replay of the same or an older code; null when no step matches.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timeMs: number,
  lastUsedStep: number | null = null,
): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secretBase32);
  const current = totpStep(timeMs);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    // Check every candidate so timing does not depend on which one matched.
    if (safeEqual(hotp(key, step), clean) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && matched <= lastUsedStep) return null;
  return matched;
}

/** How far (in steps) findTotpDrift looks either side: 20 steps = 10 minutes. */
export const TOTP_DRIFT_SEARCH_STEPS = 20;

/**
 * Diagnosis only, never a sign-in: after verifyTotp refused a code, checks
 * whether it belongs to a time step further away (up to `maxSteps` either
 * side, outside the normal one-step window). A match means the server's or
 * the phone's clock is off, for example when the server cannot reach its
 * time servers during an internet cut. Returns the offset in steps
 * (positive: the phone is ahead of the server), or null. Steps at or before
 * `lastUsedStep` are ignored: a replayed code is not a clock problem.
 */
export function findTotpDrift(
  secretBase32: string,
  code: string,
  timeMs: number,
  lastUsedStep: number | null = null,
  maxSteps = TOTP_DRIFT_SEARCH_STEPS,
): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secretBase32);
  const current = totpStep(timeMs);
  let best: number | null = null;
  for (let offset = -maxSteps; offset <= maxSteps; offset += 1) {
    if (Math.abs(offset) <= 1) continue;
    const step = current + offset;
    // Check every candidate so timing does not depend on which one matched.
    const matches = safeEqual(hotp(key, step), clean);
    if (matches && (lastUsedStep === null || step > lastUsedStep) && (best === null || Math.abs(offset) < Math.abs(best))) best = offset;
  }
  return best;
}

/** otpauth:// URI for authenticator apps (shown as a QR code). */
export function totpUri(secretBase32: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
