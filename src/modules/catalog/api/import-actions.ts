"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { runJobSoon } from "@/modules/jobs/service/runner";
import { cancelProductImport, confirmProductImport, uploadProductImport, type ImportResult } from "../service/product-import";

/** Server Actions for product imports; the service authorizes every call. */

function state(result: ImportResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" ? result.field : result.status };
}

export async function uploadImportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "file_missing" };
    const result = await uploadProductImport(actor, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (result.status === "ok") await runJobSoon("imports-process");
    return state(result, "uploaded");
  });
}

export async function confirmImportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await confirmProductImport(actor, text(form, "id"));
    if (result.status === "ok") await runJobSoon("imports-process");
    return state(result, "confirmed");
  });
}

export async function cancelImportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await cancelProductImport(actor, text(form, "id")), "cancelled"));
}
