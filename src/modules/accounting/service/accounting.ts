import "server-only";
import { z } from "zod";
import type { AccountSubtype, AccountType } from "../repo/accounting-repo";
import { db, transaction } from "@/lib/db";
import { EMPTY_REQUEST_META } from "@/lib/http/request-meta";
import { cleanText, requiredText } from "@/lib/i18n/names";
import { MoneyError, parseMoneyInput, type Rial } from "@/lib/money";
import { toEnDigits } from "@/lib/persian-text";
import { recordAudit } from "@/modules/audit/service/audit";
import type { OutboxEvent } from "@/modules/jobs/domain/outbox";
import { retryOutboxEvents, troubledOutboxEvents, unfinishedOutboxEvents } from "@/modules/jobs/service/troubled";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { completedRefundForAccounting, paidOrderForAccounting } from "@/modules/sales/service/accounting-feed";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { assertBalanced, UnbalancedEntryError, type JournalLine } from "../domain/journal";
import { expenseLines, incomeLines, MAPPING_ACCOUNT_TYPE, MAPPING_KEYS, normalBalance, orderPaidLines, refundLines, type MappingKey } from "../domain/posting";
import {
  accountById,
  accountHasChildren,
  accountHasEntries,
  accountsByCodes,
  accountTotals,
  closePeriodRow,
  draftsIn,
  insertAccount,
  insertExpense,
  insertIncome,
  insertPeriod,
  insertPostedJournal,
  isReversed,
  journalByNumber,
  journalBySource,
  ledgerLines,
  listAccounts,
  listJournal,
  listMappings,
  listPeriods,
  lockJournal,
  lockPeriod,
  mappingCodes,
  openPeriodFor,
  recentExpenses,
  recentIncome,
  setMapping,
  updateAccount,
  voidMoneyRecords,
  type NewJournal,
} from "../repo/accounting-repo";

/**
 * The store's books (double entry, integer Rial). Super and Business Admins
 * keep them: accounting.view to read, accounting.post to set up accounts,
 * periods and posting accounts and to post or reverse journals,
 * accounting.period_close (fresh two-factor) to close a period,
 * expense.manage / income.manage to record expenses and other income.
 *
 * Paid orders and refunds post themselves from the outbox, as the system,
 * once the accountant has chosen the posting accounts and opened a period
 * for the date; until then they wait and can be retried from the overview.
 * Corrections are reversals: nothing posted is ever edited.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,18}$/;
const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
const SUBTYPES = ["general", "cash", "bank", "gateway_clearing", "receivable", "payable", "vat_payable", "inventory", "sales", "sales_returns", "shipping_income", "cogs"] as const;
/** Lines a manual journal form offers. */
export const MANUAL_LINES = 8;
/** Auto-posting outbox topics, for the "waiting postings" panel. */
export const POSTING_TOPICS = ["order.paid", "refund.completed"] as const;

export type AccountingResult = { status: "ok"; id?: string; number?: string } | { status: "invalid"; field: string } | { status: "not_found" } | { status: "wrong_status" };

class Stop extends Error {
  constructor(readonly result: AccountingResult) {
    super(result.status);
  }
}

function adminId(actor: Actor, permission: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(permission, "not_admin");
  return actor.userId;
}

/** The calendar day in Tehran of a moment, as the UTC midnight Date a DATE column holds. */
export function tehranDay(at: Date): Date {
  return new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(at)}T00:00:00Z`);
}

/** YYYY-MM-DD (any digits) -> UTC midnight Date, or null. */
function parseDay(input: string): Date | null {
  const text = toEnDigits(input).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

async function money(input: string, formUnit: string): Promise<Rial | "invalid" | "unit_changed"> {
  const unit = await getDisplayUnit();
  if (formUnit !== unit) return "unit_changed";
  try {
    const value = parseMoneyInput(input, unit);
    return value > 0n && value < 10n ** 17n ? value : "invalid";
  } catch (error) {
    if (error instanceof MoneyError) return "invalid";
    throw error;
  }
}

const isUnique = (error: unknown) => error instanceof Error && (("code" in error && (error as { code?: string }).code === "P2002") || error.message.includes("unique constraint") || error.message.includes("Unique constraint"));
const dbMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Codes -> ids for posting lines; every code must be an active, postable account. */
async function resolveLines(lines: readonly JournalLine[], memo: string | null): Promise<NewJournal["lines"]> {
  const accounts = await accountsByCodes(db(), [...new Set(lines.map((l) => l.accountCode))]);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  return lines.map((l) => {
    const account = byCode.get(l.accountCode);
    if (!account || !account.isActive || !account.isPostable) throw new Error(`accounting: account ${l.accountCode} is missing, inactive or not postable`);
    return { accountId: account.id, debit: l.debit, credit: l.credit, memo };
  });
}

// Automatic postings (outbox handlers, run as the system) -------------------------------------

async function postAutomatic(journal: Omit<NewJournal, "periodId" | "userId" | "lines" | "reversesId"> & { lines: JournalLine[] }): Promise<void> {
  if (await journalBySource(db(), journal.sourceType, journal.sourceId!, journal.sourceEvent!)) return;
  const period = await openPeriodFor(db(), journal.entryDate);
  if (!period) throw new Error(`accounting: no open period contains ${journal.entryDate.toISOString().slice(0, 10)} (Admin › Accounting › Setup)`);
  const lines = await resolveLines(journal.lines, null);
  try {
    await transaction(async (tx) => {
      const posted = await insertPostedJournal(tx, { ...journal, periodId: period.id, userId: null, reversesId: null, lines });
      await recordAudit(tx, EMPTY_REQUEST_META, { actorUserId: null, action: "accounting.auto_posted", entityType: "accounting_transaction", entityId: posted.id, after: { source: journal.sourceType, sourceId: journal.sourceId, event: journal.sourceEvent } });
    });
  } catch (error) {
    // Delivered twice at the same moment: the other run posted it.
    if (isUnique(error) && (await journalBySource(db(), journal.sourceType, journal.sourceId!, journal.sourceEvent!))) return;
    throw error;
  }
}

/** order.paid: the gateway owes the total; goods, shipping and tax are recognized. */
export async function postOrderPaid(event: OutboxEvent): Promise<void> {
  const order = await paidOrderForAccounting(event.aggregateId);
  if (!order) throw new Error(`accounting: order ${event.aggregateId} is not paid`);
  const lines = orderPaidLines(order, await mappingCodes(db()));
  if (lines.length === 0) return; // a free order moves no money
  await postAutomatic({ entryDate: tehranDay(order.paidAt), description: `order ${order.orderNumber}`, sourceType: "order_payment", sourceId: order.id, sourceEvent: "order.paid", lines });
}

/** refund.completed: sales returns against the account the money left from. */
export async function postRefund(event: OutboxEvent): Promise<void> {
  const refund = await completedRefundForAccounting(event.aggregateId);
  if (!refund) throw new Error(`accounting: refund ${event.aggregateId} is not completed`);
  const lines = refundLines(refund, await mappingCodes(db()));
  await postAutomatic({ entryDate: tehranDay(refund.at), description: `order ${refund.orderNumber}`, sourceType: "refund", sourceId: refund.id, sourceEvent: "refund.completed", lines });
}

// Overview and setup ---------------------------------------------------------------------------

export async function accountingOverview(actor: Actor) {
  adminId(actor, "accounting.view");
  await authorize(actor, "accounting.view", undefined, { stepUp: false });
  const [accounts, mappings, periods, waiting] = await Promise.all([listAccounts(db()), listMappings(db()), listPeriods(db()), troubledOutboxEvents(POSTING_TOPICS)]);
  const today = tehranDay(new Date());
  const mapped = new Map(mappings.map((m) => [m.key, m.accountId]));
  return {
    accounts,
    mappings: MAPPING_KEYS.map((key) => ({ key, accountId: mapped.get(key) ?? null, type: MAPPING_ACCOUNT_TYPE[key] })),
    periods,
    currentPeriod: periods.find((p) => p.status === "open" && p.startDate <= today && p.endDate >= today) ?? null,
    waiting,
    can: {
      post: actor.permissions.has("accounting.post"),
      close: actor.permissions.has("accounting.period_close"),
      expense: actor.permissions.has("expense.manage"),
      income: actor.permissions.has("income.manage"),
    },
  };
}

const accountInput = z.object({
  code: z
    .string()
    .transform((v) => toEnDigits(v).trim().toUpperCase())
    .pipe(z.string().regex(/^[0-9A-Z][0-9A-Z.-]{0,19}$/, "invalid_code")),
  name: requiredText(150, "name_required"),
  type: z.enum(ACCOUNT_TYPES, "invalid_type"),
  subtype: z.enum(SUBTYPES, "invalid_type"),
  parentId: z.string().refine((v) => v === "" || UUID.test(v), "invalid_parent"),
  isPostable: z.boolean(),
});

export async function createAccount(actor: Actor, input: { code: string; name: string; type: string; subtype: string; parentId: string; isPostable: boolean }): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  const parsed = accountInput.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const { code, name, type, subtype, isPostable } = parsed.data;
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await accountById(db(), parsed.data.parentId);
    if (!parent) return { status: "invalid", field: "invalid_parent" };
    if (parent.type !== type) return { status: "invalid", field: "parent_type" };
    parentId = parent.id;
  }
  try {
    const id = await transaction(async (tx) => {
      const id = await insertAccount(tx, { code, name, type: type as AccountType, subtype: subtype as AccountSubtype, parentId, isPostable });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.account_created", entityType: "financial_account", entityId: id, after: { code, name, type, subtype, parentId, isPostable } });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    if (isUnique(error)) return { status: "invalid", field: "code_taken" };
    throw error;
  }
}

export async function editAccount(actor: Actor, id: string, input: { name: string; isActive: boolean; isPostable: boolean }): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  if (!UUID.test(id)) return { status: "not_found" };
  const account = await accountById(db(), id);
  if (!account) return { status: "not_found" };
  const name = requiredText(150, "name_required").safeParse(input.name);
  if (!name.success) return { status: "invalid", field: "name_required" };
  // A heading (not postable) can't hold lines; an account with lines stays postable.
  if (!input.isPostable && account.isPostable && (await accountHasEntries(db(), id))) return { status: "invalid", field: "has_entries" };
  if (input.isPostable && !account.isPostable && (await accountHasChildren(db(), id))) return { status: "invalid", field: "has_children" };
  await transaction(async (tx) => {
    await updateAccount(tx, id, { name: name.data, isActive: input.isActive, isPostable: input.isPostable });
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.account_updated", entityType: "financial_account", entityId: id, before: { name: account.name, isActive: account.isActive, isPostable: account.isPostable }, after: { name: name.data, isActive: input.isActive, isPostable: input.isPostable } });
  });
  return { status: "ok", id };
}

/** Chooses (or clears) the account an automatic posting uses. */
export async function choosePostingAccount(actor: Actor, key: string, accountId: string): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  const mappingKey = MAPPING_KEYS.find((k) => k === key) as MappingKey | undefined;
  if (!mappingKey) return { status: "invalid", field: "invalid" };
  let chosen: string | null = null;
  if (accountId) {
    const account = UUID.test(accountId) ? await accountById(db(), accountId) : null;
    if (!account || !account.isActive || !account.isPostable) return { status: "invalid", field: "invalid_account" };
    if (account.type !== MAPPING_ACCOUNT_TYPE[mappingKey]) return { status: "invalid", field: "wrong_account_type" };
    chosen = account.id;
  }
  const before = (await listMappings(db())).find((m) => m.key === mappingKey)?.accountId ?? null;
  await transaction(async (tx) => {
    await setMapping(tx, mappingKey, chosen);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.mapping_set", entityType: "account_mapping", entityId: null, before: { key: mappingKey, accountId: before }, after: { key: mappingKey, accountId: chosen } });
  });
  return { status: "ok" };
}

export async function createPeriod(actor: Actor, input: { name: string; startDate: string; endDate: string }): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  const name = requiredText(60, "name_required").safeParse(input.name);
  if (!name.success) return { status: "invalid", field: "name_required" };
  const start = parseDay(input.startDate);
  const end = parseDay(input.endDate);
  if (!start || !end) return { status: "invalid", field: "invalid_date" };
  if (end < start) return { status: "invalid", field: "end_before_start" };
  if (end.getTime() - start.getTime() > 400 * 24 * 60 * 60_000) return { status: "invalid", field: "period_too_long" };
  try {
    const id = await transaction(async (tx) => {
      const id = await insertPeriod(tx, { name: name.data, startDate: start, endDate: end });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.period_created", entityType: "financial_period", entityId: id, after: { name: name.data, startDate: input.startDate, endDate: input.endDate } });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    if (dbMessage(error).includes("financial_periods_no_overlap")) return { status: "invalid", field: "period_overlap" };
    throw error;
  }
}

/** Closes a period for good: nothing more can be posted into it (fresh two-factor). */
export async function closePeriod(actor: Actor, id: string, now = new Date()): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.period_close");
  await authorize(actor, "accounting.period_close");
  if (!UUID.test(id)) return { status: "not_found" };
  try {
    await transaction(async (tx) => {
      const period = await lockPeriod(tx, id);
      if (!period) throw new Stop({ status: "not_found" });
      if (period.status !== "open") throw new Stop({ status: "wrong_status" });
      if ((await draftsIn(tx, id)) > 0) throw new Stop({ status: "invalid", field: "drafts_open" });
      // A waiting posting may belong to this period: once closed it could never be posted.
      if ((await unfinishedOutboxEvents(POSTING_TOPICS, tx)) > 0) throw new Stop({ status: "invalid", field: "postings_waiting" });
      await closePeriodRow(tx, id, userId, now);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.period_closed", entityType: "financial_period", entityId: id, before: { status: "open" }, after: { status: "closed", name: period.name } });
    });
    return { status: "ok" };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    throw error;
  }
}

/** Puts waiting automatic postings back in line (after accounts or a period were set up). */
export async function retryPostings(actor: Actor): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  const count = await transaction(async (tx) => {
    const count = await retryOutboxEvents(POSTING_TOPICS, new Date(), tx);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.postings_retried", entityType: "outbox_event", entityId: null, after: { count } });
    return count;
  });
  return { status: "ok", number: String(count) };
}

// Journal -------------------------------------------------------------------------------------

const PAGE = 50;
/** Lines an account's ledger shows at most (narrow the dates for more). */
const LEDGER_LINES = 500;

export async function journalForAdmin(actor: Actor, page = 1) {
  adminId(actor, "accounting.view");
  await authorize(actor, "accounting.view", undefined, { stepUp: false });
  const current = Math.min(Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)), 10_000);
  const [{ rows, total }, accounts] = await Promise.all([listJournal(db(), (current - 1) * PAGE, PAGE), listAccounts(db())]);
  return {
    rows: rows.map((r) => ({ ...r, amount: r.entries.reduce((sum, e) => sum + e.debit, 0n) })),
    page: current,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    accounts: accounts.filter((a) => a.isActive && a.isPostable),
    canPost: actor.permissions.has("accounting.post"),
  };
}

export async function journalEntryForAdmin(actor: Actor, journalNumber: string) {
  adminId(actor, "accounting.view");
  await authorize(actor, "accounting.view", undefined, { stepUp: false });
  if (!NUMBER.test(journalNumber)) return null;
  const journal = await journalByNumber(db(), BigInt(journalNumber));
  if (!journal || journal.status !== "posted") return null;
  return { journal, canReverse: actor.permissions.has("accounting.post") && !journal.reversedBy && !journal.reverses };
}

/**
 * A journal typed by the accountant: up to MANUAL_LINES lines, each with an
 * account and a debit or a credit, which must balance. The form's one-time
 * key makes a double press post once.
 */
export async function postManualJournal(
  actor: Actor,
  input: { date: string; description: string; key: string; unit: string; lines: readonly { accountId: string; debit: string; credit: string; memo: string }[] },
): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  if (!UUID.test(input.key)) return { status: "invalid", field: "invalid" };
  const date = parseDay(input.date);
  if (!date) return { status: "invalid", field: "invalid_date" };
  const description = requiredText(500, "description_required").safeParse(input.description);
  if (!description.success) return { status: "invalid", field: "description_required" };
  const lines: { accountId: string; debit: bigint; credit: bigint; memo: string | null }[] = [];
  for (const line of input.lines.slice(0, MANUAL_LINES)) {
    if (!line.accountId && !line.debit.trim() && !line.credit.trim()) continue;
    if (!UUID.test(line.accountId)) return { status: "invalid", field: "invalid_account" };
    if (line.debit.trim() && line.credit.trim()) return { status: "invalid", field: "one_side" };
    const raw = line.debit.trim() || line.credit.trim();
    const amount = await money(raw, input.unit);
    if (amount === "unit_changed") return { status: "invalid", field: "unit_changed" };
    if (amount === "invalid") return { status: "invalid", field: "invalid_amount" };
    const memo = cleanText(500, "invalid_text").safeParse(line.memo);
    if (!memo.success) return { status: "invalid", field: "invalid_text" };
    lines.push({ accountId: line.accountId, debit: line.debit.trim() ? amount : 0n, credit: line.debit.trim() ? 0n : amount, memo: memo.data || null });
  }
  try {
    assertBalanced(lines.map((l) => ({ accountCode: l.accountId, debit: l.debit, credit: l.credit })));
  } catch (error) {
    if (error instanceof UnbalancedEntryError) return { status: "invalid", field: lines.length < 2 ? "two_lines" : "unbalanced" };
    throw error;
  }
  const earlier = await journalBySource(db(), "manual", input.key, "manual");
  if (earlier) return { status: "ok", id: earlier.id, number: earlier.journalNumber.toString() };
  for (const accountId of new Set(lines.map((l) => l.accountId))) {
    const account = await accountById(db(), accountId);
    if (!account || !account.isActive || !account.isPostable) return { status: "invalid", field: "invalid_account" };
  }
  const period = await openPeriodFor(db(), date);
  if (!period) return { status: "invalid", field: "no_open_period" };
  try {
    const posted = await transaction(async (tx) => {
      const posted = await insertPostedJournal(tx, { entryDate: date, periodId: period.id, description: description.data, sourceType: "manual", sourceId: input.key, sourceEvent: "manual", reversesId: null, userId, lines });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.journal_posted", entityType: "accounting_transaction", entityId: posted.id, after: { date: input.date, description: description.data, lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() })) } });
      return posted;
    });
    return { status: "ok", id: posted.id, number: posted.journalNumber.toString() };
  } catch (error) {
    if (isUnique(error)) {
      const again = await journalBySource(db(), "manual", input.key, "manual");
      if (again) return { status: "ok", id: again.id, number: again.journalNumber.toString() };
    }
    if (dbMessage(error).includes("is closed")) return { status: "invalid", field: "no_open_period" };
    if (dbMessage(error).includes("not postable or not active")) return { status: "invalid", field: "invalid_account" };
    throw error;
  }
}

/** Posts the mirror image of a journal today (corrections are reversals; nothing posted is edited). */
export async function reverseJournal(actor: Actor, journalNumber: string, reasonInput: string, now = new Date()): Promise<AccountingResult> {
  const userId = adminId(actor, "accounting.post");
  await authorize(actor, "accounting.post");
  if (!NUMBER.test(journalNumber)) return { status: "not_found" };
  const journal = await journalByNumber(db(), BigInt(journalNumber));
  if (!journal || journal.status !== "posted") return { status: "not_found" };
  if (journal.reverses) return { status: "invalid", field: "is_reversal" };
  const reason = requiredText(400, "reason_required").safeParse(reasonInput);
  if (!reason.success || reason.data.length < 3) return { status: "invalid", field: "reason_required" };
  const date = tehranDay(now);
  const period = await openPeriodFor(db(), date);
  if (!period) return { status: "invalid", field: "no_open_period" };
  try {
    const posted = await transaction(async (tx) => {
      await lockJournal(tx, journal.id);
      if (await isReversed(tx, journal.id)) throw new Stop({ status: "wrong_status" });
      const posted = await insertPostedJournal(tx, {
        entryDate: date,
        periodId: period.id,
        description: reason.data,
        sourceType: "reversal",
        sourceId: null,
        sourceEvent: null,
        reversesId: journal.id,
        userId,
        lines: journal.entries.map((e) => ({ accountId: e.account.id, debit: e.credit, credit: e.debit, memo: e.memo })),
      });
      if (journal.sourceType === "expense" || journal.sourceType === "income_record") await voidMoneyRecords(tx, journal.id);
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "accounting.journal_reversed", entityType: "accounting_transaction", entityId: posted.id, after: { reverses: journal.journalNumber.toString(), reason: reason.data } });
      return posted;
    });
    return { status: "ok", id: posted.id, number: posted.journalNumber.toString() };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    if (isUnique(error)) return { status: "wrong_status" };
    if (dbMessage(error).includes("not postable or not active")) return { status: "invalid", field: "inactive_account" };
    throw error;
  }
}

// Expenses and income -----------------------------------------------------------------------

export async function moneyBook(actor: Actor) {
  adminId(actor, "accounting.view");
  await authorize(actor, "accounting.view", undefined, { stepUp: false });
  const [expenses, income, accounts] = await Promise.all([recentExpenses(db(), 50), recentIncome(db(), 50), listAccounts(db())]);
  const usable = accounts.filter((a) => a.isActive && a.isPostable);
  return {
    expenses,
    income,
    expenseAccounts: usable.filter((a) => a.type === "expense"),
    incomeAccounts: usable.filter((a) => a.type === "income"),
    moneyAccounts: usable.filter((a) => a.type === "asset" || a.type === "liability"),
    can: { expense: actor.permissions.has("expense.manage"), income: actor.permissions.has("income.manage") },
  };
}

type MoneyRecordInput = { date: string; amount: string; unit: string; mainAccountId: string; moneyAccountId: string; party: string; description: string; key: string };

/** An expense (paid from cash, bank or a payable) or other income (into cash or bank), posted at once. */
export async function recordMoney(actor: Actor, kind: "expense" | "income", input: MoneyRecordInput): Promise<AccountingResult> {
  const permission = kind === "expense" ? "expense.manage" : "income.manage";
  const userId = adminId(actor, permission);
  await authorize(actor, permission);
  if (!UUID.test(input.key)) return { status: "invalid", field: "invalid" };
  const date = parseDay(input.date);
  if (!date) return { status: "invalid", field: "invalid_date" };
  const amount = await money(input.amount, input.unit);
  if (amount === "unit_changed") return { status: "invalid", field: "unit_changed" };
  if (amount === "invalid") return { status: "invalid", field: "invalid_amount" };
  const description = requiredText(500, "description_required").safeParse(input.description);
  if (!description.success) return { status: "invalid", field: "description_required" };
  const party = cleanText(200, "invalid_text").safeParse(input.party);
  if (!party.success) return { status: "invalid", field: "invalid_text" };
  const [main, other] = await Promise.all([UUID.test(input.mainAccountId) ? accountById(db(), input.mainAccountId) : null, UUID.test(input.moneyAccountId) ? accountById(db(), input.moneyAccountId) : null]);
  if (!main || !main.isActive || !main.isPostable || main.type !== kind) return { status: "invalid", field: "invalid_account" };
  const moneyTypes = kind === "expense" ? ["asset", "liability"] : ["asset"];
  if (!other || !other.isActive || !other.isPostable || !moneyTypes.includes(other.type)) return { status: "invalid", field: "invalid_money_account" };
  const sourceType = kind === "expense" ? ("expense" as const) : ("income_record" as const);
  const earlier = await journalBySource(db(), sourceType, input.key, kind);
  if (earlier) return { status: "ok", id: input.key, number: earlier.journalNumber.toString() };
  const period = await openPeriodFor(db(), date);
  if (!period) return { status: "invalid", field: "no_open_period" };
  const lines =
    kind === "expense"
      ? expenseLines({ amount, expenseAccount: main.code, paymentAccount: other.code })
      : incomeLines({ amount, incomeAccount: main.code, depositAccount: other.code });
  const byCode = new Map([main, other].map((a) => [a.code, a.id]));
  try {
    const posted = await transaction(async (tx) => {
      const posted = await insertPostedJournal(tx, {
        entryDate: date,
        periodId: period.id,
        description: description.data,
        sourceType,
        sourceId: input.key,
        sourceEvent: kind,
        reversesId: null,
        userId,
        lines: lines.map((l) => ({ accountId: byCode.get(l.accountCode)!, debit: l.debit, credit: l.credit, memo: party.data || null })),
      });
      const common = { amount, description: description.data, createdById: userId, accountingTransactionId: posted.id };
      if (kind === "expense") await insertExpense(tx, { ...common, expenseDate: date, expenseAccountId: main.id, paymentAccountId: other.id, vendorName: party.data || null });
      else await insertIncome(tx, { ...common, incomeDate: date, incomeAccountId: main.id, depositAccountId: other.id, payerName: party.data || null });
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: `accounting.${kind}_recorded`, entityType: kind === "expense" ? "expense" : "income_record", entityId: posted.id, after: { date: input.date, amount: amount.toString(), account: main.code, money: other.code, party: party.data || null } });
      return posted;
    });
    return { status: "ok", id: input.key, number: posted.journalNumber.toString() };
  } catch (error) {
    if (isUnique(error)) {
      const again = await journalBySource(db(), sourceType, input.key, kind);
      if (again) return { status: "ok", id: input.key, number: again.journalNumber.toString() };
    }
    if (dbMessage(error).includes("is closed")) return { status: "invalid", field: "no_open_period" };
    if (dbMessage(error).includes("not postable or not active")) return { status: "invalid", field: "invalid_account" };
    throw error;
  }
}

// Reports -------------------------------------------------------------------------------------

/**
 * Trial balance up to a day, profit and loss between two days, and an
 * account's ledger. All figures are summed from posted journal lines; no
 * totals are stored.
 */
export async function reportsForAdmin(actor: Actor, input: { from: string; to: string; accountId: string }) {
  adminId(actor, "accounting.view");
  await authorize(actor, "accounting.view", undefined, { stepUp: false });
  const today = tehranDay(new Date());
  const to = parseDay(input.to) ?? today;
  const from = parseDay(input.from) ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const [trial, period, accounts] = await Promise.all([accountTotals(db(), null, to), accountTotals(db(), from, to), listAccounts(db())]);
  const trialRows = trial.map((r) => ({ ...r, balance: normalBalance(r.type, r.debit, r.credit) }));
  const totals = { debit: trial.reduce((s, r) => s + r.debit, 0n), credit: trial.reduce((s, r) => s + r.credit, 0n) };
  const income = period.filter((r) => r.type === "income").map((r) => ({ ...r, amount: r.credit - r.debit }));
  const expenses = period.filter((r) => r.type === "expense").map((r) => ({ ...r, amount: r.debit - r.credit }));
  const incomeTotal = income.reduce((s, r) => s + r.amount, 0n);
  const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0n);
  let ledger = null;
  if (UUID.test(input.accountId)) {
    const account = accounts.find((a) => a.id === input.accountId);
    if (account) {
      const { before, lines: fetched } = await ledgerLines(db(), account.id, from, to, LEDGER_LINES + 1);
      const lines = fetched.slice(0, LEDGER_LINES);
      let running = normalBalance(account.type, before.debit, before.credit);
      const opening = running;
      ledger = {
        account,
        opening,
        cut: fetched.length > LEDGER_LINES,
        lines: lines.map((l) => {
          running += normalBalance(account.type, l.debit, l.credit);
          return { ...l, balance: running };
        }),
      };
    }
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    trial: trialRows,
    totals,
    profit: { income, expenses, incomeTotal, expenseTotal, net: incomeTotal - expenseTotal },
    accounts,
    ledger,
  };
}
