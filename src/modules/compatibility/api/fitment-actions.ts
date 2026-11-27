"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { addFitment, decideFitment, removeFitment, type FitmentResult } from "../service/fitment";

/** Server Actions for fitment links on the product screen; the service authorizes. */

function state(result: FitmentResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  if (result.status === "invalid") return { error: result.field };
  return { error: result.status };
}

export async function addFitmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await addFitment(
        actor,
        text(form, "productId"),
        {
          target: text(form, "target"),
          yearFrom: text(form, "yearFrom"),
          yearTo: text(form, "yearTo"),
          position: (text(form, "position") || "any") as "any",
          quantity: text(form, "quantity"),
          notes: text(form, "notes"),
          sourceId: text(form, "sourceId"),
        },
        { type: text(form, "sourceType"), title: text(form, "sourceTitle"), reference: text(form, "sourceReference"), url: text(form, "sourceUrl") },
      ),
      "fitmentAdded",
    ),
  );
}

export async function fitmentCommandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const productId = text(form, "productId");
    const linkId = text(form, "linkId");
    const command = text(form, "command");
    if (command === "remove") return state(await removeFitment(actor, productId, linkId), "fitmentRemoved");
    return state(await decideFitment(actor, productId, linkId, command), "fitmentDecided");
  });
}
