# Accounting

> **Professional review required.** This is a technical double-entry foundation. It has not been reviewed by an Iranian accounting professional and makes no claim of compliance with Iranian accounting standards, tax law, VAT rules or the Moadian e-invoicing system. The owner's accountant must define the chart of accounts, tax rules and posting mappings before real use.

What is implemented (Phase 3): the schema and the rules the database enforces. Posting services, reports and screens come in Phase 6.

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
7. **Idempotent posting:** `(source_type, source_id, source_event)` is unique, so an event handler that runs twice posts once.
8. Money is integer Rial (`BIGINT`) throughout; no rounding happens inside accounting.

## Default posting templates (Phase 6, accounts chosen by the accountant)

| Event | Debit | Credit |
|---|---|---|
| Order paid online | Gateway clearing | Sales income; shipping income; VAT payable (if enabled) |
| Gateway settles to bank | Bank | Gateway clearing |
| Refund | Sales returns; VAT payable | Gateway clearing or bank |
| Expense | Expense account | Cash, bank or payable |
| Manual income | Cash or bank | Income account |
| Cost of goods sold (if cost tracking is enabled) | COGS | Inventory |
