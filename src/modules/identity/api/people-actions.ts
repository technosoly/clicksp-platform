"use server";

import { env } from "@/lib/env";
import { passwordLinkPath } from "../domain/admin-account";
import {
  changeAdminRole,
  createAdminUser,
  issuePasswordLink,
  resetAdminMfa,
  revokeAdminSessions,
  setAdminStatus,
  updateAdminUser,
  type ManageError,
} from "../service/admin-users";
import { localeOf, runAdminAction, text, type ActionState } from "./admin-action";

function linkUrl(locale: string, token: string): string {
  return `${env().APP_URL.replace(/\/$/, "")}${passwordLinkPath(locale, token)}`;
}

function failure(result: ManageError): ActionState {
  switch (result.status) {
    case "invalid":
      return { error: result.field };
    case "taken":
      return { error: result.field === "email" ? "email_taken" : "username_taken" };
    default:
      return { error: result.status };
  }
}

export async function createAdminUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  return runAdminAction(form, async (actor) => {
    const result = await createAdminUser(actor, {
      username: text(form, "username"),
      email: text(form, "email"),
      name: text(form, "name"),
      roleId: text(form, "roleId"),
    });
    if (result.status !== "ok") return failure(result);
    return { ok: true, link: linkUrl(locale, result.token), expiresAt: result.expiresAt.toISOString(), message: "created" };
  });
}

export async function updateAdminUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateAdminUser(actor, text(form, "userId"), { name: text(form, "name"), email: text(form, "email") });
    return result.status === "ok" ? { ok: true, message: "saved" } : failure(result);
  });
}

export async function changeAdminRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await changeAdminRole(actor, text(form, "userId"), text(form, "roleId"));
    return result.status === "ok" ? { ok: true, message: "roleChanged" } : failure(result);
  });
}

export async function setAdminStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const status = text(form, "status") === "disabled" ? "disabled" : "active";
    const result = await setAdminStatus(actor, text(form, "userId"), status);
    return result.status === "ok" ? { ok: true, message: status === "disabled" ? "disabled" : "enabled" } : failure(result);
  });
}

export async function issuePasswordLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const locale = localeOf(form);
  return runAdminAction(form, async (actor) => {
    const result = await issuePasswordLink(actor, text(form, "userId"));
    if (result.status !== "ok") return failure(result);
    return {
      ok: true,
      link: linkUrl(locale, result.token),
      expiresAt: result.expiresAt.toISOString(),
      message: result.purpose === "admin_invite" ? "inviteIssued" : "resetIssued",
    };
  });
}

export async function resetAdminMfaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
    const result = await resetAdminMfa(actor, text(form, "userId"));
    return result.status === "ok" ? { ok: true, message: "mfaReset" } : failure(result);
  });
}

export async function revokeAdminSessionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await revokeAdminSessions(actor, text(form, "userId"));
    return result.status === "ok" ? { ok: true, message: "sessionsRevoked" } : failure(result);
  });
}
