import { describe, expect, it } from "vitest";
import { assertBalanced, reverseLines, UnbalancedEntryError, type JournalLine } from "../domain/journal";

// Account codes here are placeholders for the test only, not a seeded chart of accounts.
const sale: JournalLine[] = [
  { accountCode: "A", debit: 3_250_000n, credit: 0n },
  { accountCode: "B", debit: 0n, credit: 2_800_000n },
  { accountCode: "C", debit: 0n, credit: 450_000n },
];

describe("assertBalanced", () => {
  it("accepts a balanced entry", () => {
    expect(() => assertBalanced(sale)).not.toThrow();
  });

  it("rejects an unbalanced entry", () => {
    const broken = [...sale.slice(0, 2), { accountCode: "C", debit: 0n, credit: 449_999n }];
    expect(() => assertBalanced(broken)).toThrow(UnbalancedEntryError);
  });

  it("rejects single-line, negative and two-sided lines", () => {
    expect(() => assertBalanced([sale[0]!])).toThrow(UnbalancedEntryError);
    expect(() =>
      assertBalanced([
        { accountCode: "A", debit: -1n, credit: 0n },
        { accountCode: "B", debit: 0n, credit: -1n },
      ]),
    ).toThrow(UnbalancedEntryError);
    expect(() =>
      assertBalanced([
        { accountCode: "A", debit: 5n, credit: 5n },
        { accountCode: "B", debit: 0n, credit: 0n },
      ]),
    ).toThrow(UnbalancedEntryError);
  });
});

describe("reverseLines", () => {
  it("produces a balanced reversal that cancels the original", () => {
    const reversal = reverseLines(sale);
    expect(() => assertBalanced(reversal)).not.toThrow();
    const net = new Map<string, bigint>();
    for (const l of [...sale, ...reversal]) {
      net.set(l.accountCode, (net.get(l.accountCode) ?? 0n) + l.debit - l.credit);
    }
    expect([...net.values()].every((v) => v === 0n)).toBe(true);
  });
});
