/**
 * Database access for the books: chart of accounts, posting accounts
 * (mappings), periods, the journal, expenses and income, and the report
 * queries. The database enforces the double-entry rules (see
 * docs/ACCOUNTING.md): journals are inserted as drafts, given their lines and
 * then posted; a posted journal must balance, can't change, and can't land
 * in a closed period.
 */
import type { AccountSubtype, AccountType, JournalSourceType, Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;
export type { AccountSubtype, AccountType };

// Accounts -------------------------------------------------------------------------

const accountSelect = { id: true, code: true, name: true, type: true, subtype: true, parentId: true, isPostable: true, isActive: true } satisfies Prisma.FinancialAccountSelect;

export async function listAccounts(client: DbClient) {
  return client.financialAccount.findMany({ orderBy: { code: "asc" }, select: accountSelect });
}

export async function accountById(client: DbClient, id: string) {
  return client.financialAccount.findUnique({ where: { id }, select: accountSelect });
}

export async function accountByCode(client: DbClient, code: string) {
  return client.financialAccount.findUnique({ where: { code }, select: accountSelect });
}

export async function accountsByCodes(client: DbClient, codes: readonly string[]) {
  return client.financialAccount.findMany({ where: { code: { in: [...codes] } }, select: accountSelect });
}

export async function insertAccount(tx: Tx, row: { code: string; name: string; type: AccountType; subtype: AccountSubtype; parentId: string | null; isPostable: boolean }): Promise<string> {
  return (await tx.financialAccount.create({ data: row, select: { id: true } })).id;
}

export async function updateAccount(tx: Tx, id: string, data: { name: string; isActive: boolean; isPostable: boolean }): Promise<void> {
  await tx.financialAccount.update({ where: { id }, data });
}

export async function accountHasEntries(client: DbClient, id: string): Promise<boolean> {
  return (await client.accountingEntry.count({ where: { accountId: id }, take: 1 })) > 0;
}

export async function accountHasChildren(client: DbClient, id: string): Promise<boolean> {
  return (await client.financialAccount.count({ where: { parentId: id }, take: 1 })) > 0;
}

// Posting accounts -------------------------------------------------------------------

/** Mapping key -> account code (only active, postable accounts count). */
export async function mappingCodes(client: DbClient): Promise<Map<string, string>> {
  const rows = await client.accountMapping.findMany({ where: { account: { isActive: true, isPostable: true } }, select: { key: true, account: { select: { code: true } } } });
  return new Map(rows.map((r) => [r.key, r.account.code]));
}

export async function listMappings(client: DbClient) {
  return client.accountMapping.findMany({ select: { key: true, accountId: true } });
}

export async function setMapping(tx: Tx, key: string, accountId: string | null): Promise<void> {
  if (accountId === null) await tx.accountMapping.deleteMany({ where: { key } });
  else await tx.accountMapping.upsert({ where: { key }, create: { key, accountId }, update: { accountId } });
}

// Periods ---------------------------------------------------------------------------

export async function listPeriods(client: DbClient) {
  return client.financialPeriod.findMany({ orderBy: { startDate: "desc" }, select: { id: true, name: true, startDate: true, endDate: true, status: true, closedAt: true, closedBy: { select: { name: true } } } });
}

export async function insertPeriod(tx: Tx, row: { name: string; startDate: Date; endDate: Date }): Promise<string> {
  return (await tx.financialPeriod.create({ data: row, select: { id: true } })).id;
}

/** Locks a period (FOR UPDATE: postings into it wait, as the database locks it FOR SHARE when posting). */
export async function lockPeriod(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: string; name: string }[]>`SELECT status::text, name FROM financial_periods WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function closePeriodRow(tx: Tx, id: string, userId: string, at: Date): Promise<void> {
  await tx.financialPeriod.update({ where: { id }, data: { status: "closed", closedById: userId, closedAt: at } });
}

/** Drafts in the period (they would be stranded once it closes). */
export async function draftsIn(client: DbClient, periodId: string): Promise<number> {
  return client.accountingTransaction.count({ where: { periodId, status: "draft" } });
}

/** The open period containing a date (YYYY-MM-DD as a UTC midnight Date), if any. */
export async function openPeriodFor(client: DbClient, date: Date) {
  return client.financialPeriod.findFirst({ where: { status: "open", startDate: { lte: date }, endDate: { gte: date } }, select: { id: true, name: true } });
}

// Journal ---------------------------------------------------------------------------

export interface NewJournal {
  entryDate: Date;
  periodId: string;
  description: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  sourceEvent: string | null;
  reversesId: string | null;
  userId: string | null;
  lines: readonly { accountId: string; debit: bigint; credit: bigint; memo: string | null }[];
}

/** Draft, lines, then posted, in the caller's transaction (the database checks the balance at commit). */
export async function insertPostedJournal(tx: Tx, journal: NewJournal): Promise<{ id: string; journalNumber: bigint }> {
  const created = await tx.accountingTransaction.create({
    data: {
      entryDate: journal.entryDate,
      periodId: journal.periodId,
      description: journal.description,
      sourceType: journal.sourceType,
      sourceId: journal.sourceId,
      sourceEvent: journal.sourceEvent,
      reversesId: journal.reversesId,
      createdById: journal.userId,
    },
    select: { id: true, journalNumber: true },
  });
  await tx.accountingEntry.createMany({
    data: journal.lines.map((l, i) => ({ transactionId: created.id, lineNo: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })),
  });
  await tx.accountingTransaction.update({ where: { id: created.id }, data: { status: "posted", postedById: journal.userId, postedAt: new Date() } });
  return created;
}

export async function journalBySource(client: DbClient, sourceType: JournalSourceType, sourceId: string, sourceEvent: string) {
  return client.accountingTransaction.findFirst({ where: { sourceType, sourceId, sourceEvent }, select: { id: true, journalNumber: true } });
}

export async function listJournal(client: DbClient, skip: number, take: number) {
  const [rows, total] = await Promise.all([
    client.accountingTransaction.findMany({
      where: { status: "posted" },
      orderBy: [{ entryDate: "desc" }, { journalNumber: "desc" }],
      skip,
      take,
      select: { id: true, journalNumber: true, entryDate: true, description: true, sourceType: true, reversesId: true, reversedBy: { select: { journalNumber: true } }, entries: { select: { debit: true } } },
    }),
    client.accountingTransaction.count({ where: { status: "posted" } }),
  ]);
  return { rows, total };
}

export async function journalByNumber(client: DbClient, journalNumber: bigint) {
  return client.accountingTransaction.findUnique({
    where: { journalNumber },
    select: {
      id: true,
      journalNumber: true,
      entryDate: true,
      description: true,
      status: true,
      sourceType: true,
      sourceId: true,
      sourceEvent: true,
      postedAt: true,
      createdBy: { select: { name: true } },
      reverses: { select: { journalNumber: true } },
      reversedBy: { select: { journalNumber: true } },
      period: { select: { name: true, status: true } },
      entries: { orderBy: { lineNo: "asc" }, select: { lineNo: true, debit: true, credit: true, memo: true, account: { select: { id: true, code: true, name: true } } } },
    },
  });
}

/** Locks a posted journal so it is reversed once. */
export async function lockJournal(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM accounting_transactions WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export async function isReversed(client: DbClient, id: string): Promise<boolean> {
  return (await client.accountingTransaction.count({ where: { reversesId: id } })) > 0;
}

// Expenses and income ---------------------------------------------------------------------

export async function insertExpense(
  tx: Tx,
  row: { expenseDate: Date; expenseAccountId: string; paymentAccountId: string; amount: bigint; vendorName: string | null; description: string; createdById: string; accountingTransactionId: string },
): Promise<{ id: string; expenseNumber: bigint }> {
  return tx.expense.create({ data: { ...row, status: "recorded" }, select: { id: true, expenseNumber: true } });
}

export async function insertIncome(
  tx: Tx,
  row: { incomeDate: Date; incomeAccountId: string; depositAccountId: string; amount: bigint; payerName: string | null; description: string; createdById: string; accountingTransactionId: string },
): Promise<{ id: string; incomeNumber: bigint }> {
  return tx.incomeRecord.create({ data: { ...row, status: "recorded" }, select: { id: true, incomeNumber: true } });
}

export async function recentExpenses(client: DbClient, take: number) {
  return client.expense.findMany({
    orderBy: [{ expenseDate: "desc" }, { expenseNumber: "desc" }],
    take,
    select: { id: true, expenseNumber: true, expenseDate: true, status: true, amount: true, vendorName: true, description: true, expenseAccount: { select: { code: true, name: true } }, paymentAccount: { select: { code: true, name: true } }, accountingTransaction: { select: { journalNumber: true } } },
  });
}

export async function recentIncome(client: DbClient, take: number) {
  return client.incomeRecord.findMany({
    orderBy: [{ incomeDate: "desc" }, { incomeNumber: "desc" }],
    take,
    select: { id: true, incomeNumber: true, incomeDate: true, status: true, amount: true, payerName: true, description: true, incomeAccount: { select: { code: true, name: true } }, depositAccount: { select: { code: true, name: true } }, accountingTransaction: { select: { journalNumber: true } } },
  });
}

/** Marks the expense or income record of a reversed journal as voided. */
export async function voidMoneyRecords(tx: Tx, accountingTransactionId: string): Promise<void> {
  await tx.expense.updateMany({ where: { accountingTransactionId, status: "recorded" }, data: { status: "voided" } });
  await tx.incomeRecord.updateMany({ where: { accountingTransactionId, status: "recorded" }, data: { status: "voided" } });
}

// Reports ---------------------------------------------------------------------------------

export interface AccountTotals {
  account_id: string;
  code: string;
  name: string;
  type: string;
  debit: bigint;
  credit: bigint;
}

/** Debit and credit totals per account over posted journals between two dates (inclusive; null = open-ended). */
export async function accountTotals(client: DbClient, from: Date | null, to: Date | null): Promise<AccountTotals[]> {
  return client.$queryRaw<AccountTotals[]>`
    SELECT a.id AS account_id, a.code, a.name, a.type::text AS type,
           coalesce(sum(e.debit), 0)::bigint AS debit, coalesce(sum(e.credit), 0)::bigint AS credit
      FROM accounting_entries e
      JOIN accounting_transactions t ON t.id = e.transaction_id AND t.status = 'posted'
      JOIN financial_accounts a ON a.id = e.account_id
     WHERE (${from}::date IS NULL OR t.entry_date >= ${from}::date)
       AND (${to}::date IS NULL OR t.entry_date <= ${to}::date)
     GROUP BY a.id, a.code, a.name, a.type
     ORDER BY a.code`;
}

/** An account's posted lines between two dates, oldest first, and its balance before them. */
export async function ledgerLines(client: DbClient, accountId: string, from: Date, to: Date, take: number) {
  const [before, lines] = await Promise.all([
    client.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT coalesce(sum(e.debit), 0)::bigint AS debit, coalesce(sum(e.credit), 0)::bigint AS credit
        FROM accounting_entries e JOIN accounting_transactions t ON t.id = e.transaction_id AND t.status = 'posted'
       WHERE e.account_id = ${accountId}::uuid AND t.entry_date < ${from}::date`,
    client.accountingEntry.findMany({
      where: { accountId, transaction: { status: "posted", entryDate: { gte: from, lte: to } } },
      orderBy: [{ transaction: { entryDate: "asc" } }, { transaction: { journalNumber: "asc" } }, { lineNo: "asc" }],
      take,
      select: { debit: true, credit: true, memo: true, transaction: { select: { journalNumber: true, entryDate: true, description: true } } },
    }),
  ]);
  return { before: before[0] ?? { debit: 0n, credit: 0n }, lines };
}
