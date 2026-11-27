/**
 * Automatic postings from business events (no I/O). Which account each line
 * uses is chosen by the owner's accountant in Admin › Accounting › Posting
 * accounts (`account_mappings`); a missing mapping stops the posting with a
 * clear error instead of skipping it.
 */
import type { Rial } from "@/lib/money";
import { assertBalanced, type JournalLine } from "./journal";

export const MAPPING_KEYS = [
  "gateway_clearing",
  "sales_income",
  "sales_discounts",
  "shipping_income",
  "vat_payable",
  "sales_returns",
  "refund_bank_transfer",
  "refund_cash",
] as const;
export type MappingKey = (typeof MAPPING_KEYS)[number];

/** What each mapping should point at (type of account), to refuse obvious mistakes. */
export const MAPPING_ACCOUNT_TYPE: Record<MappingKey, "asset" | "liability" | "income" | "expense"> = {
  gateway_clearing: "asset",
  sales_income: "income",
  sales_discounts: "income",
  shipping_income: "income",
  vat_payable: "liability",
  sales_returns: "income",
  refund_bank_transfer: "asset",
  refund_cash: "asset",
};

export class MissingMappingError extends Error {
  constructor(readonly key: MappingKey) {
    super(`accounting: no account is chosen for "${key}" (Admin › Accounting › Posting accounts)`);
    this.name = "MissingMappingError";
  }
}

export type Mappings = ReadonlyMap<string, string>;

function account(mappings: Mappings, key: MappingKey): string {
  const code = mappings.get(key);
  if (!code) throw new MissingMappingError(key);
  return code;
}

/**
 * An order paid online: the gateway owes the store the total; the goods
 * (at list price), the shipping and the tax are earned (or owed to the tax
 * office), and discounts are a separate debit (a contra-income account), so
 * a discount larger than the goods still balances. Lines with a zero amount
 * are left out; an order with nothing to post returns no lines.
 */
export function orderPaidLines(order: { subtotal: Rial; discountTotal: Rial; shippingTotal: Rial; taxTotal: Rial; grandTotal: Rial }, mappings: Mappings): JournalLine[] {
  if (order.grandTotal === 0n && order.subtotal === 0n && order.discountTotal === 0n && order.shippingTotal === 0n && order.taxTotal === 0n) return [];
  const lines: JournalLine[] = [];
  if (order.grandTotal > 0n) lines.push({ accountCode: account(mappings, "gateway_clearing"), debit: order.grandTotal, credit: 0n });
  if (order.discountTotal > 0n) lines.push({ accountCode: account(mappings, "sales_discounts"), debit: order.discountTotal, credit: 0n });
  if (order.subtotal > 0n) lines.push({ accountCode: account(mappings, "sales_income"), debit: 0n, credit: order.subtotal });
  if (order.shippingTotal > 0n) lines.push({ accountCode: account(mappings, "shipping_income"), debit: 0n, credit: order.shippingTotal });
  if (order.taxTotal > 0n) lines.push({ accountCode: account(mappings, "vat_payable"), debit: 0n, credit: order.taxTotal });
  assertBalanced(lines);
  return lines;
}

/** Money paid back to a customer by bank transfer or in cash: sales returns against the account it left from. */
export function refundLines(refund: { amount: Rial; method: "bank_transfer" | "cash" | "gateway" }, mappings: Mappings): JournalLine[] {
  const from = refund.method === "cash" ? "refund_cash" : refund.method === "bank_transfer" ? "refund_bank_transfer" : "gateway_clearing";
  const lines: JournalLine[] = [
    { accountCode: account(mappings, "sales_returns"), debit: refund.amount, credit: 0n },
    { accountCode: account(mappings, from), debit: 0n, credit: refund.amount },
  ];
  assertBalanced(lines);
  return lines;
}

/** An expense paid from a cash, bank or payable account. */
export function expenseLines(expense: { amount: Rial; expenseAccount: string; paymentAccount: string }): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: expense.expenseAccount, debit: expense.amount, credit: 0n },
    { accountCode: expense.paymentAccount, debit: 0n, credit: expense.amount },
  ];
  assertBalanced(lines);
  return lines;
}

/** Income received into a cash or bank account. */
export function incomeLines(income: { amount: Rial; incomeAccount: string; depositAccount: string }): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: income.depositAccount, debit: income.amount, credit: 0n },
    { accountCode: income.incomeAccount, debit: 0n, credit: income.amount },
  ];
  assertBalanced(lines);
  return lines;
}

/** Normal balance side of an account type: assets and expenses grow on the debit side. */
export const debitNormal = (type: string) => type === "asset" || type === "expense";

/** Balance of an account in its normal direction. */
export function normalBalance(type: string, debit: Rial, credit: Rial): Rial {
  return debitNormal(type) ? debit - credit : credit - debit;
}
