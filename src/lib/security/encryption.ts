/**
 * Authenticated encryption (AES-256-GCM) for secrets the app must read back,
 * such as TOTP secrets. Keys are derived from AUTH_SECRET with HKDF and a
 * purpose label, so one leaked derived key does not expose the others.
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url parts).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export function deriveKey(secret: string, purpose: string): Buffer {
  if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "clicksp", `clicksp:${purpose}`, 32));
}

export function encryptString(key: Buffer, plaintext: string, associatedData = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Throws when the value was tampered with, or encrypted with another key or context. */
export function decryptString(key: Buffer, payload: string, associatedData = ""): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
