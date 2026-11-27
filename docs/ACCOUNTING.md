# Accounting

> **Professional review required.** This is a technical double-entry foundation. It has not been reviewed by an Iranian accounting professional and makes no claim of compliance with Iranian accounting standards, tax law, VAT rules or the Moadian e-invoicing system. The owner's accountant must define the chart of accounts, tax rules and posting mappings before real use.

What is implemented: the schema and the rules the database enforces (Phase 3), and the posting services, automatic postings, screens and reports (Phase 6, `src/modules/accounting`, admin area `/admin/accounting`).

## Tables

| Table | Purpose |
|---|---|
| `financial_accounts` | Chart of accounts: code, type (asset, liability, equity, income, expense), technical subtype (cash, bank, gateway clearing, VAT payable, sales, sales returns, COGS, ...), parent, postable flag. **Empty**: nothing is seeded. |
| `account_mappings` | Which account each automatic posting uses (e.g. `sales_income`, `gateway_clearing`). Empty; posting fails loudly when a mapping is missing. |
| `financial_periods` | Non-overlapping date ranges, open or closed. |
| `accounting_transactions` | Journal header: number, date, period, status (draft, posted), source document (order payment, refund, settlement, expense, income, inventory, manual, reversal), reversal link, who created and posted it. |
| `accounting_entries` | Journal lines: account, debit or credit (integer Rial). |
| `expenses`, `income_records` | Source documents linked to their journal transaction. |
| `cash_registers` | Cash boxes, bank and gateway accounts, each linked to an asset account (masked account numbers only). |
| `payment_transactions` | Gateway payments and refunds, linked to the journal once posted. |
| `reconciliation_statements`, `reconciliation_lines` | Imported bank or gateway statements matched to payments or journal lines. Matching never edits posted entries. |

## Rules enforced by the database

1. **Posting flow:** insert the transaction as `draft`, insert its lines, then `UPDATE ... SET status = 'posted'`. Inserting a transaction directly as posted is refused.
2. **Every posted transaction balances:** at commit it must have at least two lines and `Σ debit = Σ credit > 0` (deferred constraint trigger). Each line has exactly one positive side.
3. **Posted = immutable:** a posted transaction and its lines cannot be updated or deleted. Drafts can be edited or deleted.
4. **Corrections are reversals:** a `reversal` transaction references the posted transaction it reverses; each transaction can be reversed once and only posted transactions can be reversed. A test checks that a transaction plus its reversal nets to zero on every account.
5. **Periods:** no overlaps (exclusion constraint); postings into a closed period, or with a date outside the period, are refused; a period with transactions cannot change dates or be deleted.
6. **Accounts:** postings only to active, postable accounts in the transaction's currency; a child account has its parent's type; no cycles; accounts are never deleted (deactivate instead); an account's type cannot change once it has entries or children.
7. **Concurrency:** writing an entry locks its transaction (`FOR SHARE`) and writing a transaction locks its period, so posting, adding entries and closing a period are serialized; an entry can't slip into a journal while it is being posted (tested with two connections).
8. **Idempotent posting:** `(source_type, source_id, source_event)` is unique, so an event handler that runs twice posts once.
9. Money is integer Rial (`BIGINT`) throughout; no rounding happens inside accounting.

## Admin screens (`/admin/accounting`)

| Screen | Permission | What it does |
|---|---|---|
| Overview | `accounting.view` | Setup steps (accounts, posting accounts, an open period for today) and postings that are waiting, with a retry button (`accounting.post`). |
| Accounts | view; changes need `accounting.post` | Chart of accounts: create (code of digits, type, role, parent, postable), rename, deactivate. A child has its parent's type; an account with entries or children keeps its type. Posting accounts (mappings) are chosen here; only active, postable accounts of the expected type are accepted. |
| Periods | view; create needs `accounting.post`; close needs `accounting.period_close` with a fresh two-factor check | Periods up to one year, no overlaps. Closing is final and refused while drafts exist or any automatic posting is still waiting (it might belong to the period). |
| Journal | view; manual entries and reversals need `accounting.post` | Posted entries, newest first, and each entry's lines. A manual entry has up to 8 lines and must balance; it is dated in an open period. A reversal posts the opposite entry today; a reversal can't itself be reversed. Reversing the entry of an expense or income record marks that record voided. |
| Expenses and income | `expense.manage` / `income.manage` | An expense (paid from a cash, bank or payable account) or other income (into a cash or bank account) is recorded and posted in one transaction. |
| Reports | `accounting.view` | Profit and loss between two days, trial balance up to a day, and an account's ledger with running balance (the first 500 lines, with a notice when cut). |

All these permissions belong to Super and Business Admins only; Store Staff and customers are refused. Every change is audited. Forms carry a one-time key, so pressing twice posts once, and the amount is refused if the store's money unit changed while the form was open.

## Automatic postings

Business events reach accounting through the outbox in the same transaction as the business change:

| Event | Posting |
|---|---|
| `order.paid` | Debit gateway clearing with the grand total and sales discounts with the discount; credit sales income (list price of the goods), shipping income and VAT payable. Zero lines are left out; an order that moved no money posts nothing. |
| `refund.completed` | Debit sales returns with the refund; credit the account the money left from (refunds by bank transfer, refunds in cash, or gateway clearing). |

Postings are idempotent (one journal per source event). When a posting account is not chosen or no open period contains the day (Asia/Tehran), the posting waits and is retried; the overview shows waiting events and can retry them at once. Known gaps for the accountant to decide: a refund is charged to sales returns in full (its VAT share is not split out), gateway settlements, cost of goods sold and cash registers are not posted yet, and reconciliation has no screen.

## Posting templates (accounts chosen by the accountant)

Implemented: order paid, refund, expense, manual income. Not implemented yet: gateway settlement, cost of goods sold, VAT split on refunds.

| Event | Debit | Credit |
|---|---|---|
| Order paid online | Gateway clearing | Sales income; shipping income; VAT payable (if enabled) |
| Gateway settles to bank | Bank | Gateway clearing |
| Refund | Sales returns; VAT payable | Gateway clearing or bank |
| Expense | Expense account | Cash, bank or payable |
| Manual income | Cash or bank | Income account |
| Cost of goods sold (if cost tracking is enabled) | COGS | Inventory |
