"use server";

import { runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import {
  choosePostingAccount,
  closePeriod,
  createAccount,
  createPeriod,
  editAccount,
  MANUAL_LINES,
  postManualJournal,
  recordMoney,
  retryPostings,
  reverseJournal,
  type AccountingResult,
} from "../service/accounting";

/** Server Actions for the accounting screens; the service authorizes every call. */

const state = (result: AccountingResult, message: string): ActionState => {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" ? result.field : result.status };
};
const checked = (form: FormData, key: string) => form.get(key) === "on";

export async function createAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(
      await createAccount(actor, { code: text(form, "code"), name: text(form, "name"), type: text(form, "type"), subtype: text(form, "subtype"), parentId: text(form, "parentId"), isPostable: checked(form, "isPostable") }),
      "created",
    ),
  );
}

export async function editAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    state(await editAccount(actor, text(form, "accountId"), { name: text(form, "name"), isActive: checked(form, "isActive"), isPostable: checked(form, "isPostable") }), "saved"),
  );
}

export async function mappingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await choosePostingAccount(actor, text(form, "key"), text(form, "accountId")), "saved"));
}

export async function createPeriodAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await createPeriod(actor, { name: text(form, "name"), startDate: text(form, "startDate"), endDate: text(form, "endDate") }), "created"));
}

export async function closePeriodAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await closePeriod(actor, text(form, "periodId")), "closed"));
}

export async function retryPostingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await retryPostings(actor), "retried"));
}

export async function manualJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const lines = Array.from({ length: MANUAL_LINES }, (_, i) => ({
      accountId: text(form, `account-${i}`),
      debit: text(form, `debit-${i}`),
      credit: text(form, `credit-${i}`),
      memo: text(form, `memo-${i}`),
    }));
    return state(await postManualJournal(actor, { date: text(form, "date"), description: text(form, "description"), key: text(form, "key"), unit: text(form, "unit"), lines }), "posted");
  });
}

export async function reverseJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => state(await reverseJournal(actor, text(form, "journalNumber"), text(form, "reason")), "reversed"));
}

export async function recordMoneyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const kind = text(form, "kind");
    if (kind !== "expense" && kind !== "income") return { error: "invalid" };
    return state(
      await recordMoney(actor, kind, {
        date: text(form, "date"),
        amount: text(form, "amount"),
        unit: text(form, "unit"),
        mainAccountId: text(form, "mainAccountId"),
        moneyAccountId: text(form, "moneyAccountId"),
        party: text(form, "party"),
        description: text(form, "description"),
        key: text(form, "key"),
      }),
      `${kind}_recorded`,
    );
  });
}
