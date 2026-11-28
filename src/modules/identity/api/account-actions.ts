"use server";

import { z } from "zod";
import { currentRequestMeta } from "@/lib/http/server";
import { logger } from "@/lib/logger";
import { changeOwnPassword, revokeOwnOtherSessions, revokeOwnSession, completePasswordLink } from "../service/account";
import { regenerateOwnBackupCodes } from "../service/admin-auth";
import { localeOf, runAdminAction, text, type ActionState } from "./admin-action";

export async function changeOwnPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const next = text(form, "next");
    if (next !== text(form, "confirm")) return { error: "mismatch" };
    const result = await changeOwnPassword(actor, { current: text(form, "current"), next });
    if (result.status === "ok") return { ok: true, message: "passwordChanged" };
    if (result.status === "weak_password") return { error: result.problem };
    return { error: result.status };
  });
}

export async function revokeOwnSessionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const done = await revokeOwnSession(actor, text(form, "sessionId"));
    return done ? { ok: true, message: "sessionRevoked" } : { error: "not_found" };
  });
}

export async function revokeOwnOtherSessionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    await revokeOwnOtherSessions(actor);
    return { ok: true, message: "otherSessionsRevoked" };
  });
}

/** New backup codes; needs a current code from the authenticator app. */
export async function regenerateBackupCodesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const code = text(form, "code").slice(0, 20);
    const result = await regenerateOwnBackupCodes(actor, code, await currentRequestMeta());
    if (result.status === "ok") return { ok: true, backupCodes: result.backupCodes };
    if (result.status === "locked") return { error: "mfa_locked" };
    if (result.status === "invalid") return { error: "invalid_code" };
    return { error: "forbidden" };
  });
}

const linkSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
  confirm: z.string().max(1024),
});

/**
 * Sets a password from a one-time link (no session needed). The token comes
 * from the URL fragment, which the page copies into the form, so it never
 * appears in server logs or Referer headers.
 */
export async function setPasswordFromLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  localeOf(form);
  const parsed = linkSchema.safeParse({ token: form.get("token"), password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "invalid_link" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  try {
    const result = await completePasswordLink({ token: parsed.data.token, password: parsed.data.password }, await currentRequestMeta());
    if (result.status === "ok") return { ok: true, message: "passwordSet" };
    if (result.status === "weak_password") return { error: result.problem };
    return { error: result.status };
  } catch (error) {
    logger.error("password link failed", { error: String(error) });
    return { error: "unexpected" };
  }
}
