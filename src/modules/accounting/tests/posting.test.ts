import { describe, expect, it } from "vitest";
import { MissingMappingError, normalBalance, orderPaidLines, refundLines } from "../domain/posting";

// Placeholder codes for the test only, not a chart of accounts.
const mappings = new Map([
  ["gateway_clearing", "A1"],
  ["sales_income", "I1"],
  ["sales_discounts", "I4"],
  ["shipping_income", "I2"],
  ["vat_payable", "L1"],
  ["sales_returns", "I3"],
  ["refund_bank_transfer", "A2"],
  ["refund_cash", "A3"],
]);

describe("automatic postings", () => {
  it("splits a paid order into goods, discount, shipping and tax, leaving out zero lines", () => {
    expect(orderPaidLines({ subtotal: 1_000_000n, discountTotal: 100_000n, shippingTotal: 50_000n, taxTotal: 0n, grandTotal: 950_000n }, mappings)).toEqual([
      { accountCode: "A1", debit: 950_000n, credit: 0n },
      { accountCode: "I4", debit: 100_000n, credit: 0n },
      { accountCode: "I1", debit: 0n, credit: 1_000_000n },
      { accountCode: "I2", debit: 0n, credit: 50_000n },
    ]);
  });

  it("still balances when the discount is larger than the goods (it covers shipping)", () => {
    const lines = orderPaidLines({ subtotal: 100_000n, discountTotal: 130_000n, shippingTotal: 50_000n, taxTotal: 0n, grandTotal: 20_000n }, mappings);
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0n)).toBe(0n);
    expect(lines).toContainEqual({ accountCode: "I4", debit: 130_000n, credit: 0n });
  });

  it("posts nothing for an order that moved no money, and needs the discount account only when there is a discount", () => {
    expect(orderPaidLines({ subtotal: 0n, discountTotal: 0n, shippingTotal: 0n, taxTotal: 0n, grandTotal: 0n }, new Map())).toEqual([]);
    const fullyDiscounted = orderPaidLines({ subtotal: 10_000n, discountTotal: 10_000n, shippingTotal: 0n, taxTotal: 0n, grandTotal: 0n }, mappings);
    expect(fullyDiscounted).toEqual([
      { accountCode: "I4", debit: 10_000n, credit: 0n },
      { accountCode: "I1", debit: 0n, credit: 10_000n },
    ]);
    const noDiscount = new Map([...mappings].filter(([k]) => k !== "sales_discounts"));
    expect(orderPaidLines({ subtotal: 1_000n, discountTotal: 0n, shippingTotal: 0n, taxTotal: 0n, grandTotal: 1_000n }, noDiscount)).toHaveLength(2);
    expect(() => orderPaidLines({ subtotal: 1_000n, discountTotal: 1n, shippingTotal: 0n, taxTotal: 0n, grandTotal: 999n }, noDiscount)).toThrow(MissingMappingError);
  });

  it("refuses an order whose totals don't add up", () => {
    expect(() => orderPaidLines({ subtotal: 1_000n, discountTotal: 0n, shippingTotal: 0n, taxTotal: 0n, grandTotal: 999n }, mappings)).toThrow();
  });

  it("posts a refund from the account the money left", () => {
    expect(refundLines({ amount: 5_000n, method: "cash" }, mappings)[1]).toEqual({ accountCode: "A3", debit: 0n, credit: 5_000n });
    expect(refundLines({ amount: 5_000n, method: "bank_transfer" }, mappings)[1]!.accountCode).toBe("A2");
  });

  it("fails loudly when an account isn't chosen", () => {
    expect(() => refundLines({ amount: 1n, method: "cash" }, new Map())).toThrow(MissingMappingError);
  });

  it("shows balances on each account type's normal side", () => {
    expect(normalBalance("asset", 100n, 30n)).toBe(70n);
    expect(normalBalance("income", 30n, 100n)).toBe(70n);
  });
});
