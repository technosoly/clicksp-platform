/**
 * Password hashing with Argon2id (OWASP Password Storage Cheat Sheet minimum:
 * m=19 MiB, t=2, p=1) and the admin password policy.
 *
 * Erasable TypeScript only: also used by the `pnpm admin:create-super` CLI.
 */
import { hash, verify } from "@node-rs/argon2";

/** @node-rs/argon2 Algorithm.Argon2id (a const enum, so not importable under type stripping). */
const ARGON2ID = 2;

const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = "too_short" | "too_long" | "same_as_identifier";

/**
 * Admin password policy: length is what matters (NIST SP 800-63B); no
 * composition rules. Any Unicode text is allowed, including Persian.
 */
export function checkPasswordPolicy(password: string, identifiers: string[] = []): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return "too_short";
  if (length > PASSWORD_MAX_LENGTH) return "too_long";
  const lower = password.toLowerCase();
  if (identifiers.some((id) => id.length > 0 && lower === id.toLowerCase())) return "same_as_identifier";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real verification when the account does not
 * exist, so response time does not reveal which usernames exist.
 */
export async function verifyPasswordAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash("clicksp-dummy-password-for-timing", OPTIONS);
  await verifyPassword(await dummyHash, password);
  return false;
}
