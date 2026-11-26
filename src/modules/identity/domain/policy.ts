/**
 * Authentication policy: session lifetimes, OTP and MFA limits. Values that
 * the Super Admin can tune live in system_settings (security.*); the numbers
 * here are the defaults used when a setting is missing, and the fixed limits.
 * Pure, no I/O.
 */

export type SessionKind = "admin" | "customer";

export interface SessionTimes {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SecurityPolicy {
  adminIdleMinutes: number;
  adminAbsoluteHours: number;
  mfaRequiredLevels: number[];
  stepUpMfaSeconds: number;
  loginMaxPerAccount: number;
  loginMaxPerIp: number;
  loginWindowMinutes: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  adminIdleMinutes: 30,
  adminAbsoluteHours: 12,
  mfaRequiredLevels: [1, 2],
  stepUpMfaSeconds: 300,
  loginMaxPerAccount: 5,
  loginMaxPerIp: 20,
  loginWindowMinutes: 15,
};

/** A signed-in admin who still has to pass (or enrol) TOTP gets this long. */
export const ADMIN_PENDING_MFA_MINUTES = 10;

/** Customer sessions: long-lived on the phone, revoked on logout. */
export const CUSTOMER_IDLE_DAYS = 14;
export const CUSTOMER_ABSOLUTE_DAYS = 30;

/** last_seen_at is written at most this often, to keep reads cheap. */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export const OTP = {
  digits: 6,
  ttlMinutes: 3,
  maxAttempts: 5,
  /** Sends per phone number in the window. */
  maxSendsPerPhone: 3,
  /** Sends per IP address in the window (one household, many phones). */
  maxSendsPerIp: 10,
  windowMinutes: 10,
} as const;

export const MFA = {
  maxFailures: 5,
  lockMinutes: 15,
  backupCodeCount: 10,
} as const;

/**
 * Permissions that touch money or prices. A Store Staff member who holds any
 * of them must use TOTP too (rbac-security skill), whatever the level setting.
 */
export const FINANCIAL_PERMISSIONS: ReadonlySet<string> = new Set([
  "price.update",
  "price.update.propose",
  "discount.manage",
  "coupon.manage",
  "refund.create",
  "order.view_payment",
  "inventory.view_cost",
  "accounting.view",
  "accounting.post",
  "accounting.period_close",
  "expense.manage",
  "income.manage",
  "report.financial",
  "payment_provider.view",
  "payment_provider.configure",
]);

export function isMfaRequired(level: number, permissionKeys: Iterable<string>, policy: SecurityPolicy): boolean {
  if (policy.mfaRequiredLevels.includes(level)) return true;
  for (const key of permissionKeys) if (FINANCIAL_PERMISSIONS.has(key)) return true;
  return false;
}

export type SessionState = "active" | "revoked" | "expired" | "idle";

/** Whether a session can still be used at `now`. Admin sessions also time out when idle. */
export function sessionState(kind: SessionKind, s: SessionTimes, now: Date, policy: SecurityPolicy): SessionState {
  if (s.revokedAt) return "revoked";
  if (now.getTime() >= s.expiresAt.getTime()) return "expired";
  const idleMs =
    kind === "admin" ? policy.adminIdleMinutes * 60_000 : CUSTOMER_IDLE_DAYS * 24 * 60 * 60_000;
  if (now.getTime() - s.lastSeenAt.getTime() >= idleMs) return "idle";
  return "active";
}

/** Absolute expiry of a new session. */
export function sessionExpiry(kind: SessionKind, mfaPending: boolean, now: Date, policy: SecurityPolicy): Date {
  if (kind === "customer") return new Date(now.getTime() + CUSTOMER_ABSOLUTE_DAYS * 24 * 60 * 60_000);
  if (mfaPending) return new Date(now.getTime() + ADMIN_PENDING_MFA_MINUTES * 60_000);
  return new Date(now.getTime() + policy.adminAbsoluteHours * 60 * 60_000);
}

export function isMfaFresh(mfaVerifiedAt: Date | null, now: Date, policy: SecurityPolicy): boolean {
  return mfaVerifiedAt !== null && now.getTime() - mfaVerifiedAt.getTime() <= policy.stepUpMfaSeconds * 1000;
}
