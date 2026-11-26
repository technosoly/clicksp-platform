"use server";

import { redirect } from "@/lib/i18n/navigation";
import { localeOf, runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import type { GrantChange } from "../domain/escalation";
import { createRole, setRolePermissions, updateRole, type RoleChangeResult } from "../service/roles";

function failure(result: Exclude<RoleChangeResult, { status: "ok" }>): ActionState {
  return { error: result.status === "invalid" ? result.field : result.status };
}

export async function createRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let roleId: string | null = null;
  const state = await runAdminAction(form, async (actor) => {
    const result = await createRole(actor, {
      key: text(form, "key"),
      name: text(form, "name"),
      description: text(form, "description"),
      level: text(form, "level"),
    });
    if (result.status !== "ok") return failure(result);
    roleId = result.roleId;
    return { ok: true };
  });
  if (roleId) redirect({ href: `/admin/people/roles/${roleId}`, locale: localeOf(form) });
  return state;
}

export async function updateRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateRole(actor, text(form, "roleId"), {
      name: text(form, "name"),
      description: text(form, "description"),
      isActive: form.get("isActive") === "on",
    });
    return result.status === "ok" ? { ok: true, message: "saved" } : failure(result);
  });
}

/** Checkbox names: grant:<key> (held) and scoped:<key> (limited to the user's scopes). */
export async function setRolePermissionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const grants: GrantChange[] = [];
    for (const [name, value] of form.entries()) {
      if (typeof value !== "string" || !name.startsWith("grant:")) continue;
      const key = name.slice("grant:".length);
      grants.push({ key, isScoped: form.get(`scoped:${key}`) === "on" });
    }
    const result = await setRolePermissions(actor, text(form, "roleId"), grants);
    return result.status === "ok" ? { ok: true, message: "permissionsSaved" } : failure(result);
  });
}
