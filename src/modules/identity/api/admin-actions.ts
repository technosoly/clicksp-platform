"use server";

import { z } from "zod";
import { currentRequestMeta } from "@/lib/http/server";
import { isLocale } from "@/lib/i18n/config";
import { redirect } from "@/lib/i18n/navigation";
import { logger } from "@/lib/logger";
import {
  adminPasswordLogin,
  confirmMfaEnrolment,
  recordAdminLogout,
  verifyAdminMfa,
} from "../service/admin-auth";
import { endSession } from "../service/sessions";
import { currentAdmin } from "./admin-guard";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookies";

export type FormState = { error?: string; backupCodes?: string[] } | undefined;

const localeOf = (form: FormData): string => {
  const value = form.get("locale");
  return isLocale(value) ? value : "fa";
};

const loginSchema = z.object({
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export async function adminLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const locale = localeOf(form);
  const parsed = loginSchema.safeParse({ identifier: form.get("identifier"), password: form.get("password") });
  if (!parsed.success) return { error: "required" };
  let next: string;
  try {
    const result = await adminPasswordLogin(parsed.data, await currentRequestMeta());
    if (result.status === "rate_limited") return { error: "rate_limited" };
    if (result.status === "invalid") return { error: "invalid_credentials" };
    await setSessionCookie("admin", result.session);
    next = result.next === "challenge" ? "/admin/mfa" : result.next === "setup" ? "/admin/mfa/setup" : "/admin";
  } catch (error) {
    logger.error("admin login failed", { error: String(error) });
    return { error: "unexpected" };
  }
  redirect({ href: next, locale });
}

const codeSchema = z.object({ code: z.string().min(6).max(20) });

export async function adminMfaAction(_prev: FormState, form: FormData): Promise<FormState> {
  const locale = localeOf(form);
  const parsed = codeSchema.safeParse({ code: form.get("code") });
  if (!parsed.success) return { error: "invalid_code" };
  const ctx = await currentAdmin();
  if (!ctx) redirect({ href: "/admin/login", locale });
  try {
    const result = await verifyAdminMfa(ctx!, parsed.data.code, await currentRequestMeta());
    if (result.status === "locked") return { error: "mfa_locked" };
    if (result.status === "not_allowed") return { error: "unexpected" };
    if (result.status === "invalid") return { error: "invalid_code" };
    if (result.session) await setSessionCookie("admin", result.session);
  } catch (error) {
    logger.error("admin MFA failed", { error: String(error) });
    return { error: "unexpected" };
  }
  redirect({ href: "/admin", locale });
}

export async function adminMfaSetupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const locale = localeOf(form);
  const parsed = codeSchema.safeParse({ code: form.get("code") });
  if (!parsed.success) return { error: "invalid_code" };
  const ctx = await currentAdmin();
  if (!ctx) redirect({ href: "/admin/login", locale });
  try {
    const result = await confirmMfaEnrolment(ctx!, parsed.data.code, await currentRequestMeta());
    if (result.status === "invalid") return { error: "invalid_code" };
    if (result.status === "not_allowed") return { error: "unexpected" };
    await setSessionCookie("admin", result.session);
    // Shown once; the user continues to the dashboard from the page.
    return { backupCodes: result.backupCodes };
  } catch (error) {
    logger.error("admin MFA setup failed", { error: String(error) });
    return { error: "unexpected" };
  }
}

export async function adminLogoutAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const userId = await endSession(await readSessionToken("admin"), "admin");
  if (userId) await recordAdminLogout(userId, await currentRequestMeta());
  await clearSessionCookie("admin");
  redirect({ href: "/admin/login", locale });
}
