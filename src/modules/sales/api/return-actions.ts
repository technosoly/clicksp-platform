"use server";

import { refresh } from "next/cache";
import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { decideReturn, receiveReturn, refundOrder, requestReturn } from "../service/returns";

/** Server Actions for returns and refunds; the services authorize every call. */

const state = (result: { status: string; field?: string }, message: string): ActionState => {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" && result.field ? result.field : result.status };
};

export async function decideReturnAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const decision = text(form, "decision");
    if (decision !== "approve" && decision !== "reject" && decision !== "close") return { error: "invalid" };
    return state(await decideReturn(actor, text(form, "returnNumber"), decision, text(form, "note")), decision);
  });
}

export async function receiveReturnAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const lines = form.getAll("itemId").map((raw) => {
      const itemId = String(raw);
      return { itemId, restock: form.get(`restock-${itemId}`) === "on", locationId: text(form, `location-${itemId}`), condition: text(form, `condition-${itemId}`) };
    });
    return state(await receiveReturn(actor, text(form, "returnNumber"), lines), "received");
  });
}

export async function refundAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await refundOrder(actor, text(form, "orderNumber"), {
        amount: text(form, "amount"),
        method: text(form, "method"),
        reason: text(form, "reason"),
        returnNumber: text(form, "returnNumber"),
        idempotencyKey: text(form, "idempotencyKey"),
      }),
      "refunded",
    ),
  );
}

export interface ReturnRequestState {
  /** Translation key under Orders.returns.errors. */
  error?: string;
  ok?: boolean;
}

/** The signed-in customer asks to return units of one of their orders (the customer comes from the session only). */
export async function requestReturnAction(_prev: ReturnRequestState, form: FormData): Promise<ReturnRequestState> {
  const customer = await currentCustomer();
  if (!customer) return { error: "signed_out" };
  const quantities: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("qty-") && typeof value === "string") quantities[key.slice(4, 4 + 36)] = value.slice(0, 10);
  }
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const result = await requestReturn(customer, field("orderNumber"), { reason: field("reason"), note: field("note"), quantities });
  if (result.status !== "ok") return { error: result.status === "invalid" ? result.field : result.status };
  refresh();
  return { ok: true };
}
