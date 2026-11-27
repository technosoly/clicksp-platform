"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { isSectionType, propsFromForm, visibilityFromForm } from "../domain/registry";
import { discardHomeDraft, editHome, publishHome, restoreHomeRevision, type BuilderEdit, type BuilderResult } from "../service/builder";

/** Server Actions for the home page builder; the services authorize every call. */

function state(result: BuilderResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" ? result.field : result.status };
}

/** add / move / remove / update, chosen by the form's `command`. */
export async function editSectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const command = text(form, "command");
    const base = text(form, "base");
    const id = text(form, "sectionId");
    let edit: BuilderEdit;
    if (command === "add") edit = { kind: "add", type: text(form, "type") };
    else if (command === "up" || command === "down") edit = { kind: "move", id, direction: command };
    else if (command === "remove") {
      if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
      edit = { kind: "remove", id };
    } else if (command === "update") {
      const type = text(form, "type");
      if (!isSectionType(type)) return { error: "invalid" };
      const has = (name: string) => form.get(name) === "on";
      const props = propsFromForm(type, (name) => text(form, name), has);
      if ("field" in props) return { error: props.field };
      const visibility = visibilityFromForm(has);
      if ("field" in visibility) return { error: visibility.field };
      edit = { kind: "update", id, props: props.props, visibility };
    } else return { error: "invalid" };
    return state(await editHome(actor, base, edit), "draftSaved");
  });
}

export async function discardDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
    return state(await discardHomeDraft(actor, text(form, "base")), "draftDiscarded");
  });
}

export async function publishAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await publishHome(actor, text(form, "base"), text(form, "note")), "published"));
}

export async function restoreAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    if (text(form, "confirm") !== "yes") return { error: "confirm_required" };
    return state(await restoreHomeRevision(actor, text(form, "base"), text(form, "revisionId")), "restored");
  });
}
