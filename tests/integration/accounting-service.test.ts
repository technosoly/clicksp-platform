/**
 * The books through the real services on PostgreSQL: chart of accounts,
 * posting accounts, periods, automatic postings from paid orders and refunds,
 * manual journals, reversals, expenses, income and reports. Account codes and
 * names are synthetic (TEST ...); nothing here is a real chart of accounts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import {
  accountingOverview,
  journalForAdmin,
  moneyBook,
  choosePostingAccount,
  closePeriod,
  createAccount,
  createPeriod,
  editAccount,
  journalEntryForAdmin,
  postManualJournal,
  postOrderPaid,
  postRefund,
  recordMoney,
  reportsForAdmin,
  retryPostings,
  reverseJournal,
  tehranDay,
} from "@/modules/accounting/service/accounting";
import { dispatchOutbox } from "@/modules/jobs/service/outbox";
import { OUTBOX_HANDLERS } from "@/modules/jobs/service/handlers";
import { AuthzError, MfaRequiredError } from "@/modules/rbac/service/authorize";
import { addToCart } from "@/modules/sales/service/cart";
import { myOrder, placeOrder } from "@/modules/sales/service/checkout";
import { refundOrder } from "@/modules/sales/service/returns";
import { actorFor, q } from "./admin-actors";
import { uid } from "./helpers";
import { address, customer, ok, part, setup } from "./order-fixtures";

afterAll(async () => {
  await prisma().$disconnect();
});

type Admin = Awaited<ReturnType<typeof actorFor>>;
let sa: Admin;
const acc: Record<string, string> = {};
const code = (name: string) => `T${uid().slice(0, 8).toUpperCase()}${name}`.slice(0, 20);

async function account(name: string, type: string, subtype = "general") {
  const c = code(name);
  const r = ok(await createAccount(sa, { code: c, name: `TEST ${name}`, type, subtype, parentId: "", isPostable: true }));
  acc[name] = r.id!;
  return { id: r.id!, code: c };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** A placed order marked paid as the gateway would (payment row + status history). */
async function paidOrder() {
  const { methodId } = await setup();
  const p = await part(5);
  const c = await customer();
  ok(await addToCart(c, { variantId: p.variantId, quantity: "1" }));
  const number = ok(await placeOrder(c, address(methodId), "fa")).orderNumber.toString();
  const order = (await myOrder(c, number))!;
  const [provider] = await q<{ id: string }>(
    "INSERT INTO payment_providers (code, adapter_key) VALUES ('test_paid', 'test_paid') ON CONFLICT (code) DO UPDATE SET adapter_key = EXCLUDED.adapter_key RETURNING id",
  );
  const ref = `T${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await q(
    `INSERT INTO payment_transactions (order_id, provider_id, status, amount, our_reference, idempotency_key, provider_reference, verified_at)
     VALUES ($1, $2, 'succeeded', $3, $4, $4, $4, now())`,
    [order.id, provider!.id, order.grandTotal.toString(), ref],
  );
  await q("UPDATE orders SET status = 'paid' WHERE id = $1", [order.id]);
  return { number, order };
}

const event = (aggregateId: string, topic: string) => ({ id: randomUUID(), topic, aggregateType: "x", aggregateId, payload: {}, attempts: 1 });

beforeAll(async () => {
  sa = await actorFor("super_admin");
  await account("CLEAR", "asset", "gateway_clearing");
  await account("BANK", "asset", "bank");
  await account("CASH", "asset", "cash");
  await account("SALES", "income", "sales");
  await account("SHIP", "income", "shipping_income");
  await account("RETURNS", "income", "sales_returns");
  await account("DISC", "income");
  await account("VAT", "liability", "vat_payable");
  await account("RENT", "expense");
  await account("OTHERINC", "income");
});

describe("accounting setup", () => {
  it("creates accounts with checked codes and parents; headings and lines don't mix", async () => {
    const heading = ok(await createAccount(sa, { code: code("HEAD"), name: "TEST heading", type: "expense", subtype: "general", parentId: "", isPostable: false }));
    ok(await createAccount(sa, { code: code("CHILD"), name: "TEST child", type: "expense", subtype: "general", parentId: heading.id!, isPostable: true }));
    expect(await createAccount(sa, { code: code("BAD"), name: "TEST", type: "income", subtype: "general", parentId: heading.id!, isPostable: true })).toEqual({ status: "invalid", field: "parent_type" });
    expect(await createAccount(sa, { code: "bad code!", name: "TEST", type: "asset", subtype: "general", parentId: "", isPostable: true })).toEqual({ status: "invalid", field: "invalid_code" });
    const dup = code("DUP");
    ok(await createAccount(sa, { code: dup, name: "TEST", type: "asset", subtype: "general", parentId: "", isPostable: true }));
    expect(await createAccount(sa, { code: dup.toLowerCase(), name: "TEST", type: "asset", subtype: "general", parentId: "", isPostable: true })).toEqual({ status: "invalid", field: "code_taken" });
    expect(await editAccount(sa, heading.id!, { name: "TEST heading", isActive: true, isPostable: true })).toEqual({ status: "invalid", field: "has_children" });
  });

  it("chooses posting accounts of the right type only", async () => {
    expect(await choosePostingAccount(sa, "sales_income", acc.BANK!)).toEqual({ status: "invalid", field: "wrong_account_type" });
    expect(await choosePostingAccount(sa, "nope", acc.SALES!)).toEqual({ status: "invalid", field: "invalid" });
    ok(await choosePostingAccount(sa, "gateway_clearing", acc.CLEAR!));
    ok(await choosePostingAccount(sa, "sales_income", acc.SALES!));
    ok(await choosePostingAccount(sa, "sales_discounts", acc.DISC!));
    ok(await choosePostingAccount(sa, "shipping_income", acc.SHIP!));
    ok(await choosePostingAccount(sa, "vat_payable", acc.VAT!));
    ok(await choosePostingAccount(sa, "sales_returns", acc.RETURNS!));
    ok(await choosePostingAccount(sa, "refund_cash", acc.CASH!));
    // refund_bank_transfer is left unset on purpose (a refund by bank waits for it).
  });
});

describe("automatic postings", () => {
  it("waits for a period, then posts a paid order once; a refund waits for its account", async () => {
    const { order, number } = await paidOrder();
    const paidDay = tehranDay(new Date());
    // No open period yet for today: the handler fails and the event is retried later.
    await expect(postOrderPaid(event(order.id, "order.paid"))).rejects.toThrow(/no open period/);

    const start = new Date(Date.UTC(paidDay.getUTCFullYear(), paidDay.getUTCMonth(), 1));
    const end = new Date(Date.UTC(paidDay.getUTCFullYear(), paidDay.getUTCMonth() + 1, 0));
    expect(await createPeriod(sa, { name: "TEST month", startDate: day(end), endDate: day(start) })).toEqual({ status: "invalid", field: "end_before_start" });
    ok(await createPeriod(sa, { name: "TEST month", startDate: day(start), endDate: day(end) }));
    expect(await createPeriod(sa, { name: "TEST overlap", startDate: day(start), endDate: day(start) })).toEqual({ status: "invalid", field: "period_overlap" });

    await Promise.all([postOrderPaid(event(order.id, "order.paid")), postOrderPaid(event(order.id, "order.paid"))]);
    const lines = await q<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, e.debit::text, e.credit::text FROM accounting_entries e JOIN accounting_transactions t ON t.id = e.transaction_id JOIN financial_accounts a ON a.id = e.account_id
        WHERE t.source_type = 'order_payment' AND t.source_id = $1 ORDER BY e.line_no`,
      [order.id],
    );
    expect(lines.map((l) => [l.debit, l.credit])).toEqual([
      [order.grandTotal.toString(), "0"],
      ...(order.discountTotal > 0n ? [[order.discountTotal.toString(), "0"]] : []),
      ["0", order.subtotal.toString()],
      ...(order.shippingTotal > 0n ? [["0", order.shippingTotal.toString()]] : []),
    ]);

    // A cash refund posts; a bank refund waits until refund_bank_transfer is chosen.
    const cash = ok(await refundOrder(sa, number, { amount: "100", method: "cash", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() }));
    await postRefund(event(cash.refundId, "refund.completed"));
    expect(await q("SELECT 1 FROM accounting_transactions WHERE source_type = 'refund' AND source_id = $1", [cash.refundId])).toHaveLength(1);
    const bank = ok(await refundOrder(sa, number, { amount: "100", method: "bank_transfer", reason: "TEST", returnNumber: "", idempotencyKey: randomUUID() }));
    await expect(postRefund(event(bank.refundId, "refund.completed"))).rejects.toThrow(/refund_bank_transfer/);

    // Through the outbox: the waiting event shows up, and once the account is chosen a retry posts it.
    await dispatchOutbox(new Map([["refund.completed", OUTBOX_HANDLERS.get("refund.completed")!]]));
    expect((await accountingOverview(sa)).waiting.rows.some((r) => r.aggregateId === bank.refundId)).toBe(true);
    ok(await choosePostingAccount(sa, "refund_bank_transfer", acc.BANK!));
    ok(await retryPostings(sa));
    await dispatchOutbox(new Map([["refund.completed", OUTBOX_HANDLERS.get("refund.completed")!]]));
    expect(await q("SELECT 1 FROM accounting_transactions WHERE source_type = 'refund' AND source_id = $1", [bank.refundId])).toHaveLength(1);
  });
});

describe("Business Admin", () => {
  it("keeps the books like a Super Admin", async () => {
    const ba = await actorFor("business_admin");
    expect((await accountingOverview(ba)).accounts.length).toBeGreaterThan(0);
    expect((await moneyBook(ba)).can).toEqual({ expense: true, income: true });
    ok(await createAccount(ba, { code: code("BA"), name: "TEST by business admin", type: "expense", subtype: "general", parentId: "", isPostable: true }));
  });
});

describe("journals, expenses and reports", () => {
  it("posts balanced manual journals once, reverses once, and reports from the lines", async () => {
    const today = day(tehranDay(new Date()));
    const lines = (debit: string, credit: string) => [
      { accountId: acc.BANK!, debit, credit: "", memo: "" },
      { accountId: acc.OTHERINC!, debit: "", credit, memo: "TEST" },
    ];
    expect(await postManualJournal(sa, { date: today, description: "TEST", key: randomUUID(), unit: "toman", lines: lines("1000", "999") })).toEqual({ status: "invalid", field: "unbalanced" });
    expect(await postManualJournal(sa, { date: today, description: "TEST", key: randomUUID(), unit: "toman", lines: lines("1000", "").slice(0, 1) })).toEqual({ status: "invalid", field: "two_lines" });
    expect(await postManualJournal(sa, { date: "2001-01-01", description: "TEST", key: randomUUID(), unit: "toman", lines: lines("1", "1") })).toEqual({ status: "invalid", field: "no_open_period" });
    expect(await postManualJournal(sa, { date: today, description: "TEST", key: randomUUID(), unit: "rial", lines: lines("1", "1") })).toEqual({ status: "invalid", field: "unit_changed" });
    const key = randomUUID();
    const [a, b] = await Promise.all([
      postManualJournal(sa, { date: today, description: "TEST opening", key, unit: "toman", lines: lines("۱۰۰۰", "1000") }),
      postManualJournal(sa, { date: today, description: "TEST opening", key, unit: "toman", lines: lines("1000", "1000") }),
    ]);
    const posted = ok(a);
    expect(b).toEqual(a);
    expect(await q("SELECT 1 FROM accounting_transactions WHERE source_type = 'manual' AND source_id = $1", [key])).toHaveLength(1);

    const reports0 = await reportsForAdmin(sa, { from: "", to: "", accountId: acc.BANK! });
    const bankBefore = reports0.trial.find((r) => r.account_id === acc.BANK)!.balance;
    expect(reports0.totals.debit).toBe(reports0.totals.credit);

    const [r1, r2] = await Promise.all([reverseJournal(sa, posted.number!, "TEST wrong"), reverseJournal(sa, posted.number!, "TEST wrong")]);
    expect([r1.status, r2.status].sort()).toEqual(["ok", "wrong_status"]);
    const reversal = ok(r1.status === "ok" ? r1 : r2);
    expect(await reverseJournal(sa, reversal.number!, "TEST again")).toEqual({ status: "invalid", field: "is_reversal" });
    expect((await journalEntryForAdmin(sa, posted.number!))?.canReverse).toBe(false);
    const reports1 = await reportsForAdmin(sa, { from: "", to: "", accountId: acc.BANK! });
    // 1,000 Toman = 10,000 Rial in and back out.
    expect(bankBefore - reports1.trial.find((r) => r.account_id === acc.BANK)!.balance).toBe(10_000n);
    expect(reports1.ledger?.lines.at(-1)?.balance).toBe(reports1.trial.find((r) => r.account_id === acc.BANK)!.balance);

    // An expense paid from the bank and other income into cash, posted at once; profit follows.
    const expenseKey = randomUUID();
    ok(await recordMoney(sa, "expense", { date: today, amount: "500", mainAccountId: acc.RENT!, moneyAccountId: acc.BANK!, party: "TEST landlord", description: "TEST rent", key: expenseKey, unit: "toman" }));
    ok(await recordMoney(sa, "expense", { date: today, amount: "500", mainAccountId: acc.RENT!, moneyAccountId: acc.BANK!, party: "TEST landlord", description: "TEST rent", key: expenseKey, unit: "toman" }));
    expect(await q("SELECT 1 FROM expenses WHERE description = 'TEST rent'")).toHaveLength(1);
    expect(await recordMoney(sa, "expense", { date: today, amount: "500", mainAccountId: acc.SALES!, moneyAccountId: acc.BANK!, party: "", description: "TEST", key: randomUUID(), unit: "toman" })).toEqual({ status: "invalid", field: "invalid_account" });
    ok(await recordMoney(sa, "income", { date: today, amount: "200", mainAccountId: acc.OTHERINC!, moneyAccountId: acc.CASH!, party: "", description: "TEST scrap sale", key: randomUUID(), unit: "toman" }));
    const reports2 = await reportsForAdmin(sa, { from: "", to: "", accountId: "" });
    expect(reports2.profit.net).toBe(reports2.profit.incomeTotal - reports2.profit.expenseTotal);
    expect(reports2.profit.expenses.find((r) => r.account_id === acc.RENT)?.amount).toBe(5_000n);
    expect(reports2.totals.debit).toBe(reports2.totals.credit);

    // Reversing an expense's journal voids the expense too.
    const expenseJournal = (await q<{ n: string }>("SELECT t.journal_number::text AS n FROM expenses x JOIN accounting_transactions t ON t.id = x.accounting_transaction_id WHERE x.description = 'TEST rent'"))[0]!.n;
    ok(await reverseJournal(sa, expenseJournal, "TEST entered twice"));
    expect(await q("SELECT status::text FROM expenses WHERE description = 'TEST rent'")).toEqual([{ status: "voided" }]);
  });

  it("closes a period with a fresh two-factor check; nothing posts into it afterwards", async () => {
    const period = ok(await createPeriod(sa, { name: "TEST old", startDate: "2020-01-01", endDate: "2020-12-31" }));
    ok(await postManualJournal(sa, { date: "2020-06-01", description: "TEST", key: randomUUID(), unit: "toman", lines: [
      { accountId: acc.BANK!, debit: "10", credit: "", memo: "" },
      { accountId: acc.OTHERINC!, debit: "", credit: "10", memo: "" },
    ] }));
    const stale = { ...sa, mfaVerifiedAt: new Date(Date.now() - 24 * 60 * 60_000) };
    await expect(closePeriod(stale, period.id!)).rejects.toBeInstanceOf(MfaRequiredError);
    // A posting still waiting might belong to this period: closing waits for it.
    const [waiting] = await q<{ id: string }>("INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload) VALUES ('order.paid', 'order', gen_random_uuid(), '{}') RETURNING id");
    expect(await closePeriod(sa, period.id!)).toEqual({ status: "invalid", field: "postings_waiting" });
    // (Test only: other suites in this database leave their own events behind.)
    await q("UPDATE outbox_events SET status = 'done' WHERE topic IN ('order.paid', 'refund.completed') AND status <> 'done'");
    expect(waiting).toBeDefined();
    ok(await closePeriod(sa, period.id!));
    expect(await closePeriod(sa, period.id!)).toEqual({ status: "wrong_status" });
    expect(await postManualJournal(sa, { date: "2020-06-02", description: "TEST", key: randomUUID(), unit: "toman", lines: [
      { accountId: acc.BANK!, debit: "10", credit: "", memo: "" },
      { accountId: acc.OTHERINC!, debit: "", credit: "10", memo: "" },
    ] })).toEqual({ status: "invalid", field: "no_open_period" });
  });

  it("refuses Store Staff and customers everywhere", async () => {
    const staff = await actorFor("store_staff", [], []);
    await expect(accountingOverview(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(createAccount(staff, { code: code("X"), name: "TEST", type: "asset", subtype: "general", parentId: "", isPostable: true })).rejects.toBeInstanceOf(AuthzError);
    await expect(postManualJournal(staff, { date: "2026-01-01", description: "TEST", key: randomUUID(), unit: "toman", lines: [] })).rejects.toBeInstanceOf(AuthzError);
    await expect(recordMoney(staff, "expense", { date: "2026-01-01", amount: "1", mainAccountId: "", moneyAccountId: "", party: "", description: "", key: randomUUID(), unit: "toman" })).rejects.toBeInstanceOf(AuthzError);
    await expect(reportsForAdmin(staff, { from: "", to: "", accountId: "" })).rejects.toBeInstanceOf(AuthzError);
    await expect(closePeriod(staff, randomUUID())).rejects.toBeInstanceOf(AuthzError);
    await expect(retryPostings(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(editAccount(staff, acc.BANK!, { name: "TEST", isActive: true, isPostable: true })).rejects.toBeInstanceOf(AuthzError);
    await expect(choosePostingAccount(staff, "sales_income", acc.SALES!)).rejects.toBeInstanceOf(AuthzError);
    await expect(createPeriod(staff, { name: "TEST", startDate: "2019-01-01", endDate: "2019-01-31" })).rejects.toBeInstanceOf(AuthzError);
    await expect(reverseJournal(staff, "1", "TEST reason")).rejects.toBeInstanceOf(AuthzError);
    await expect(journalForAdmin(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(journalEntryForAdmin(staff, "1")).rejects.toBeInstanceOf(AuthzError);
    await expect(moneyBook(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(recordMoney(staff, "income", { date: "2026-01-01", amount: "1", unit: "toman", mainAccountId: "", moneyAccountId: "", party: "", description: "", key: randomUUID() })).rejects.toBeInstanceOf(AuthzError);
    // Someone allowed to record income only can't record expenses.
    const incomeOnly = { ...sa, permissions: new Map([...sa.permissions].filter(([k]) => k === "accounting.view" || k === "income.manage")) };
    await expect(recordMoney(incomeOnly, "expense", { date: "2026-01-01", amount: "1", unit: "toman", mainAccountId: "", moneyAccountId: "", party: "", description: "", key: randomUUID() })).rejects.toBeInstanceOf(AuthzError);
    const customerActor = { ...sa, kind: "customer" as const };
    await expect(moneyBook(customerActor)).rejects.toBeInstanceOf(AuthzError);
    await expect(accountingOverview(customerActor)).rejects.toBeInstanceOf(AuthzError);
  });
});
