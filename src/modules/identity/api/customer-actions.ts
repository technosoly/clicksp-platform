"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { currentRequestMeta } from "@/lib/http/server";
import { isLocale } from "@/lib/i18n/config";
import { redirect } from "@/lib/i18n/navigation";
import { logger } from "@/lib/logger";
import { requestPhoneOtp, verifyPhoneOtp } from "../service/customer-auth";
import { endSession } from "../service/sessions";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookies";

export type OtpFormState =
  | { step: "phone"; error?: string; phone?: string }
  | { step: "code"; phone: string; error?: string; expiresInSeconds?: number };

const localeOf = (form: FormData): string => {
  const value = form.get("locale");
  return isLocale(value) ? value : "fa";
};

const phoneSchema = z.string().min(8).max(32);
const codeSchema = z.string().min(4).max(12);

/** One action for both steps of the phone sign-in form (intent = request | verify). */
export async function phoneLoginAction(prev: OtpFormState, form: FormData): Promise<OtpFormState> {
  return form.get("intent") === "verify" ? verifyOtp(prev, form) : requestOtp(form);
}

async function requestOtp(form: FormData): Promise<OtpFormState> {
  const locale = localeOf(form);
  const phone = phoneSchema.safeParse(form.get("phone"));
  if (!phone.success) return { step: "phone", error: "invalid_phone" };
  try {
    const t = await getTranslations({ locale, namespace: "CustomerAuth" });
    const result = await requestPhoneOtp(
      { phone: phone.data, renderText: (code) => t("smsText", { code }) },
      await currentRequestMeta(),
    );
    if (result.status === "sent") return { step: "code", phone: result.phone, expiresInSeconds: result.expiresInSeconds };
    return { step: "phone", phone: phone.data, error: result.status };
  } catch (error) {
    logger.error("OTP request failed", { error: String(error) });
    return { step: "phone", phone: phone.data, error: "unexpected" };
  }
}

async function verifyOtp(prev: OtpFormState, form: FormData): Promise<OtpFormState> {
  const locale = localeOf(form);
  const phone = phoneSchema.safeParse(form.get("phone"));
  const code = codeSchema.safeParse(form.get("code"));
  if (!phone.success) return { step: "phone", error: "invalid_phone" };
  if (!code.success) return { step: "code", phone: phone.data, error: "invalid_code" };
  try {
    const result = await verifyPhoneOtp({ phone: phone.data, code: code.data }, await currentRequestMeta());
    if (result.status !== "ok") {
      if (result.status === "expired" || result.status === "too_many_attempts") {
        return { step: "phone", phone: phone.data, error: result.status };
      }
      return { step: "code", phone: phone.data, error: result.status };
    }
    await endSession(await readSessionToken("customer"), "customer");
    await setSessionCookie("customer", result.session);
  } catch (error) {
    logger.error("OTP verification failed", { error: String(error) });
    return { ...prev, step: "code", phone: phone.data, error: "unexpected" };
  }
  redirect({ href: "/account", locale });
  return prev;
}

export async function customerLogoutAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  await endSession(await readSessionToken("customer"), "customer");
  await clearSessionCookie("customer");
  redirect({ href: "/", locale });
}
