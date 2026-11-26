---
name: accounting-engine
description: Double-entry accounting foundation for Clicksp — chart of accounts, journals, debit/credit entries, financial periods, income, expenses, payment reconciliation, refunds and financial reports, all in integer Rial with immutable posted records. Use when working on anything that creates, posts, reverses or reports financial data.
---

# Accounting engine

## Activation conditions
- Code in `src/modules/accounting`, outbox handlers for `order.paid`, `refund.created`, `expense.recorded`.
- Reports: P&L, balance summary, cash/bank, sales by period.

## Purpose
Books that always balance, cannot be silently altered, and can be traced from any report figure back to the source document.

## Technical requirements: data model
- `financial_accounts` (chart of accounts): `code`, `type` (`asset | liability | equity | income | expense`), `parent_id`, `is_postable`, `currency_code`. Bank and cash accounts are asset accounts; `cash_registers` link to one.
- `financial_periods(start_date, end_date, status: open | closed)`.
- `accounting_transactions` (journal header): `number`, `date`, `period_id`, `description`, `status: draft | posted`, `source_type/source_id` (order, refund, expense, income_record, manual), `reverses_id?`, `posted_by`, `posted_at`.
- `accounting_entries`: `transaction_id`, `account_id`, `debit BIGINT`, `credit BIGINT` (exactly one > 0, CHECK), `memo`.
- `income_records`, `expenses` (with attachments in `media_library`), `payment_transactions` link to their journal.

## Workflow: rules for every financial change
1. **Every posted transaction balances** (sum debit = sum credit > 0). Enforced by deferred constraint trigger (see `database-architect/references/sql-patterns.md`) **and** by the domain function before insert.
2. **Posted = immutable.** No UPDATE/DELETE of posted transactions or their entries (trigger). Corrections create a **reversal** transaction (`reverses_id`), swapping debit/credit, then a new correct transaction.
3. Postings into a `closed` period are rejected; corrections go into the current open period with a reference to the original.
4. Money is integer Rial (`bigint`) via `src/lib/money`. No rounding inside accounting; amounts arrive already rounded by the source (order snapshot).
5. Posting from business events is automatic and idempotent: outbox handler keyed by `(source_type, source_id, event)` → unique constraint prevents double posting.
6. Seed only a minimal technical chart of accounts skeleton (top-level groups) marked editable. The owner or accountant defines real accounts. Posting rules map event types to accounts via settings, and posting fails loudly if a mapping is missing.
7. **Do not claim** compliance with Iranian accounting standards or tax law. Documentation must say the structure requires review by an Iranian accounting professional.

## Default posting templates (accounts configurable)
| Event | Debit | Credit |
|---|---|---|
| Order paid (online) | Gateway clearing (asset) | Sales income; Shipping income; VAT payable (if configured) |
| Gateway settlement to bank | Bank | Gateway clearing |
| Refund issued | Sales returns (contra-income); VAT payable | Gateway clearing or Bank |
| Expense recorded | Expense account | Cash / Bank / Payable |
| Manual income | Cash / Bank | Income account |
| Cost of goods sold (when cost tracking enabled) | COGS | Inventory asset |

## Reconciliation
- Bank/gateway statement lines imported (CSV) into a staging table; matched to `payment_transactions` / journal lines by reference and amount; unmatched lines listed for manual action. Matching never edits posted entries.

## Reports
- Trial balance, P&L by period, account ledger, cash/bank book, sales summary. All computed from entries (no stored totals), with drill-down to source documents. Exports to CSV/XLSX with formula-injection escaping.

## Security requirements
- Permissions: `accounting.view`, `accounting.post`, `accounting.period_close`, `expense.manage`, `report.financial`. Staff have none by default.
- All postings, reversals and period closes are audited.
- Period close requires recent MFA.

## Expected outputs
- Accounting services, posting handlers, reports, `docs/ACCOUNTING.md` describing accounts, posting templates and the professional-review disclaimer.

## Documentation references
- Double-entry fundamentals (Martin Fowler, Accounting Patterns): https://martinfowler.com/eaaDev/AccountingNarrative.html
- PostgreSQL constraint triggers: https://www.postgresql.org/docs/current/sql-createtrigger.html

## Testing requirements
- Unbalanced transaction cannot be posted (domain + DB).
- UPDATE/DELETE of posted entries fails; reversal produces net zero per account.
- Posting into a closed period fails.
- `order.paid` handler run twice posts once.
- Order paid → refund → balances per account match expected values (integer Rial).
- Missing account mapping → posting fails with clear error, not silent skip.
- Staff and customers get 403 on all accounting endpoints.
