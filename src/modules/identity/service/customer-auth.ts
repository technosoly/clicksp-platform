import "server-only";
import { randomUUID } from "node:crypto";
import { db, transaction } from "@/lib/db";
import { authSecret, env } from "@/lib/env";
import type { RequestMeta } from "@/lib/http/request-meta";
import { deriveKey } from "@/lib/security/encryption";
import { hmacSha256Hex, randomNumericCode, safeEqual } from "@/lib/security/tokens";
import { logger } from "@/lib/logger";
import { toEnDigits } from "@/lib/persian-text";
import { recordAudit, recordSecurityEvent } from "@/modules/audit/service/audit";
import { countSecurityEvents } from "@/modules/audit/repo/audit-repo";
import { getSecurityPolicy } from "@/modules/settings/service/security-policy";
import { maskPhone, normalizeIranianMobile } from "../domain/phone";
import { OTP } from "../domain/policy";
import {
  consumeVerificationToken,
  countFailedLogins,
  countVerificationTokens,
  createCustomer,
  createVerificationToken,
  findUserIdByPhone,
  getUserSummary,
  latestVerificationToken,
  markPhoneVerified,
  recordLoginAttempt,
  setLastLogin,
  spendVerificationAttempt,
} from "../repo/identity-repo";
import { isCustomerAccount } from "../repo/admin-users-repo";
import { createSmsSender, disabledSmsSender, type SmsSender } from "../sms/sms-adapter";
import { issueSession, resolveSession, type IssuedSession } from "./sessions";

let sender: SmsSender | undefined;

/** The configured SMS sender (SMS_PROVIDER). Tests can replace it. */
export function smsSender(): SmsSender {
  if (!sender) {
    try {
      sender = createSmsSender({ provider: env().SMS_PROVIDER, nodeEnv: process.env.NODE_ENV, appEnv: env().APP_ENV });
    } catch (error) {
      // e.g. SMS_PROVIDER=console on a production build: phone sign-in stays off.
      logger.error("SMS provider refused; phone sign-in is disabled", { error: String(error) });
      sender = disabledSmsSender;
    }
  }
  return sender;
}

export function setSmsSenderForTests(next: SmsSender | undefined): void {
  sender = next;
}

/** Whether phone sign-in can work at all (an SMS provider is configured). */
export function isPhoneLoginAvailable(): boolean {
  return smsSender().enabled;
}

function otpHash(tokenId: string, code: string): string {
  // Keyed hash: a leaked database row cannot be brute-forced offline over the
  // million possible codes without the server secret.
  return hmacSha256Hex(deriveKey(authSecret(), "phone-otp"), `${tokenId}:${code}`);
}

export type OtpRequestResult =
  | { status: "sent"; phone: string; expiresInSeconds: number }
  | { status: "invalid_phone" }
  | { status: "unavailable" }
  | { status: "rate_limited" }
  | { status: "send_failed" };

/**
 * Sends a one-time sign-in code by SMS. The same answer is given whether or
 * not an account exists for the number (one is created on first sign-in).
 */
export async function requestPhoneOtp(
  input: { phone: string; renderText: (code: string) => string },
  meta: RequestMeta,
  now = new Date(),
): Promise<OtpRequestResult> {
  const phone = normalizeIranianMobile(input.phone);
  if (!phone) return { status: "invalid_phone" };
  const sms = smsSender();
  if (!sms.enabled) return { status: "unavailable" };

  const since = new Date(now.getTime() - OTP.windowMinutes * 60_000);
  const day = new Date(now.getTime() - 24 * 60 * 60_000);
  // Requests without a valid client IP share one "unknown" bucket (null).
  const [byPhone, byPhoneDay, byIp, global] = await Promise.all([
    countVerificationTokens(db(), { purpose: "phone_otp", identifier: phone, since }),
    countVerificationTokens(db(), { purpose: "phone_otp", identifier: phone, since: day }),
    countSecurityEvents(db(), { type: "otp.requested", ipAddress: meta.ipAddress, since }),
    countVerificationTokens(db(), { purpose: "phone_otp", since }),
  ]);
  const scope =
    byPhone >= OTP.maxSendsPerPhone
      ? "phone"
      : byPhoneDay >= OTP.maxSendsPerPhonePerDay
        ? "phone_day"
        : byIp >= OTP.maxSendsPerIp
          ? "ip"
          : global >= OTP.maxSendsGlobal
            ? "global"
            : null;
  if (scope) {
    await recordSecurityEvent(meta, {
      type: "otp.rate_limited",
      severity: scope === "global" ? "critical" : "warning",
      details: { scope, phone: maskPhone(phone) },
    });
    return { status: "rate_limited" };
  }

  const existing = await findUserIdByPhone(db(), phone);
  const code = randomNumericCode(OTP.digits);
  const tokenId = randomUUID();
  await createVerificationToken(db(), {
    id: tokenId,
    purpose: "phone_otp",
    identifier: phone,
    userId: existing?.id ?? null,
    valueHash: otpHash(tokenId, code),
    expiresAt: new Date(now.getTime() + OTP.ttlMinutes * 60_000),
    now,
  });
  await recordSecurityEvent(meta, { type: "otp.requested", severity: "info", details: { phone: maskPhone(phone) } });

  try {
    const result = await sms.send({ to: phone, text: input.renderText(code), purpose: "otp" });
    if (!result.ok) throw new Error(result.error ?? "provider refused");
  } catch (error) {
    logger.error("OTP SMS not sent", { provider: sms.name, to: maskPhone(phone), error: String(error) });
    return { status: "send_failed" };
  }
  return { status: "sent", phone, expiresInSeconds: OTP.ttlMinutes * 60 };
}

export type OtpVerifyResult =
  | { status: "ok"; session: IssuedSession; userId: string; isNewCustomer: boolean }
  | { status: "invalid_phone" }
  | { status: "invalid_code" }
  | { status: "expired" }
  | { status: "too_many_attempts" }
  | { status: "rate_limited" }
  | { status: "account_disabled" };

export async function verifyPhoneOtp(
  input: { phone: string; code: string },
  meta: RequestMeta,
  now = new Date(),
): Promise<OtpVerifyResult> {
  const phone = normalizeIranianMobile(input.phone);
  if (!phone) return { status: "invalid_phone" };
  const code = toEnDigits(input.code).replace(/\s/g, "");
  const since = new Date(now.getTime() - OTP.windowMinutes * 60_000);
  const failedFromIp = await countFailedLogins(db(), { ipAddress: meta.ipAddress, failureReason: "invalid_code", since });
  if (failedFromIp >= OTP.maxFailedVerifiesPerIp) {
    await recordSecurityEvent(meta, { type: "otp.verify_rate_limited", details: { phone: maskPhone(phone) } });
    return { status: "rate_limited" };
  }
  const token = await latestVerificationToken(db(), "phone_otp", phone);
  if (!token || token.consumedAt || token.expiresAt <= now) return { status: "expired" };
  if (!(await spendVerificationAttempt(db(), token.id, OTP.maxAttempts))) {
    await recordSecurityEvent(meta, { type: "otp.too_many_attempts", details: { phone: maskPhone(phone) } });
    return { status: "too_many_attempts" };
  }
  const fail = async (status: "invalid_code" | "account_disabled", userId: string | null): Promise<OtpVerifyResult> => {
    await recordLoginAttempt(db(), {
      identifier: phone,
      userId,
      success: false,
      failureReason: status,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { status };
  };
  if (!/^\d{6}$/.test(code) || !safeEqual(otpHash(token.id, code), token.valueHash)) return fail("invalid_code", token.userId);
  if (!(await consumeVerificationToken(db(), token.id, now))) return { status: "expired" };

  const existing = await findUserIdByPhone(db(), phone);
  if (existing && existing.status !== "active") return fail("account_disabled", existing.id);
  // Admin accounts never get a customer session, even with a verified phone
  // number: they sign in at /admin with a password and two-factor.
  if (existing && !(await isCustomerAccount(db(), existing.id))) {
    await recordSecurityEvent(meta, { type: "otp.admin_phone_refused", severity: "warning", userId: existing.id });
    return fail("account_disabled", existing.id);
  }

  const policy = await getSecurityPolicy();
  return transaction(async (tx) => {
    let userId = existing?.id ?? null;
    const isNewCustomer = userId === null;
    if (userId === null) {
      userId = await createCustomer(tx, phone);
      await recordAudit(tx, meta, {
        actorUserId: userId,
        action: "customer.registered",
        entityType: "user",
        entityId: userId,
        after: { phone: maskPhone(phone), method: "phone_otp" },
      });
    } else {
      await markPhoneVerified(tx, userId);
    }
    const session = await issueSession(tx, { userId, kind: "customer", mfaVerifiedAt: null, mfaPending: false, meta, policy, now });
    await recordLoginAttempt(tx, { identifier: phone, userId, success: true, failureReason: null, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    await setLastLogin(tx, userId, now);
    return { status: "ok" as const, session, userId, isNewCustomer };
  });
}

export async function getCustomer(token: string | undefined, now = new Date()) {
  const policy = await getSecurityPolicy();
  const session = await resolveSession(token, "customer", policy, now);
  if (!session) return null;
  if (!(await isCustomerAccount(db(), session.userId))) return null;
  const user = await getUserSummary(db(), session.userId);
  if (!user) return null;
  return { session, user };
}
