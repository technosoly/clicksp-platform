/**
 * Pure double-entry rules (no I/O). The database enforces the same rules with
 * a deferred constraint trigger (Phase 3); this check gives early, readable
 * errors before anything is written.
 */
import { add, MoneyError, type Rial } from "@/lib/money";

export interface JournalLine {
  accountCode: string;
  debit: Rial;
  credit: Rial;
}

export class UnbalancedEntryError extends MoneyError {
  constructor(message: string) {
    super(message);
    this.name = "UnbalancedEntryError";
  }
}

/** Throws unless the lines form a valid, balanced journal entry. */
export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) throw new UnbalancedEntryError("A journal entry needs at least two lines");
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n) {
      throw new UnbalancedEntryError("Debit and credit must not be negative");
    }
    if ((line.debit === 0n) === (line.credit === 0n)) {
      throw new UnbalancedEntryError("Each line must have exactly one of debit or credit");
    }
  }
  const debits = add(...lines.map((l) => l.debit));
  const credits = add(...lines.map((l) => l.credit));
  if (debits !== credits) {
    throw new UnbalancedEntryError(`Entry does not balance: debit ${debits} != credit ${credits}`);
  }
}

/** The reversal of a posted entry: same accounts, debit and credit swapped. */
export function reverseLines(lines: readonly JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit }));
}
