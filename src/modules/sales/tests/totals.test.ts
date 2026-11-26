import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money";
import { assertRefundAllowed, computeOrderTotals, refundableAmount } from "../domain/totals";

describe("computeOrderTotals", () => {
  it("adds lines, shipping and no tax by default", () => {
    const t = computeOrderTotals({
      lines: [
        { unitPrice: 1_250_000n, quantity: 2 },
        { unitPrice: 300_000n, quantity: 1 },
      ],
      shipping: 450_000n,
      rounding: "half_up",
    });
    expect(t.subtotal).toBe(2_800_000n);
    expect(t.discountTotal).toBe(0n);
    expect(t.goodsTotal).toBe(2_800_000n);
    expect(t.shipping).toBe(450_000n);
    expect(t.tax).toBe(0n);
    expect(t.total).toBe(3_250_000n);
  });

  it("applies line and order discounts and allocates the order discount exactly", () => {
    const t = computeOrderTotals({
      lines: [
        { unitPrice: 100_000n, quantity: 1, lineDiscount: 10_000n },
        { unitPrice: 100_000n, quantity: 2 },
      ],
      orderDiscount: 100_001n,
      shipping: 0n,
      rounding: "half_up",
    });
    expect(t.discountTotal).toBe(110_001n);
    expect(t.goodsTotal).toBe(189_999n);
    const allocated = t.lines.reduce((a, l) => a + l.allocatedOrderDiscount, 0n);
    expect(allocated).toBe(100_001n);
    expect(t.lines.reduce((a, l) => a + l.net, 0n)).toBe(t.goodsTotal);
  });

  it("caps the order discount at the goods value", () => {
    const t = computeOrderTotals({
      lines: [{ unitPrice: 50_000n, quantity: 1 }],
      orderDiscount: 80_000n,
      shipping: 20_000n,
      rounding: "half_up",
    });
    expect(t.goodsTotal).toBe(0n);
    expect(t.total).toBe(20_000n);
  });

  it("makes shipping free at the threshold", () => {
    const base = { lines: [{ unitPrice: 1_000_000n, quantity: 1 }], shipping: 300_000n, rounding: "half_up" } as const;
    expect(computeOrderTotals({ ...base, freeShippingThreshold: 1_000_000n }).shipping).toBe(0n);
    expect(computeOrderTotals({ ...base, freeShippingThreshold: 1_000_001n }).shipping).toBe(300_000n);
  });

  it("computes tax on discounted goods with the configured rounding", () => {
    const t = computeOrderTotals({
      lines: [{ unitPrice: 12_345n, quantity: 1 }],
      shipping: 0n,
      taxBasisPoints: 1_000,
      rounding: "half_up",
    });
    expect(t.tax).toBe(1_235n); // 1234.5 -> 1235
    expect(t.total).toBe(13_580n);
  });

  it("rejects invalid input", () => {
    expect(() => computeOrderTotals({ lines: [], shipping: 0n, rounding: "half_up" })).toThrow(MoneyError);
    expect(() =>
      computeOrderTotals({ lines: [{ unitPrice: 1n, quantity: 0 }], shipping: 0n, rounding: "half_up" }),
    ).toThrow(MoneyError);
    expect(() =>
      computeOrderTotals({ lines: [{ unitPrice: 1n, quantity: 1.5 }], shipping: 0n, rounding: "half_up" }),
    ).toThrow(MoneyError);
    expect(() =>
      computeOrderTotals({
        lines: [{ unitPrice: 10n, quantity: 1, lineDiscount: 11n }],
        shipping: 0n,
        rounding: "half_up",
      }),
    ).toThrow(MoneyError);
    expect(() =>
      computeOrderTotals({ lines: [{ unitPrice: 10n, quantity: 1 }], shipping: -1n, rounding: "half_up" }),
    ).toThrow(MoneyError);
  });
});

describe("refunds", () => {
  it("computes the refundable amount", () => {
    expect(refundableAmount(1_000_000n, 250_000n)).toBe(750_000n);
    expect(refundableAmount(1_000_000n, 1_000_000n)).toBe(0n);
  });

  it("allows partial refunds up to the paid amount and rejects more", () => {
    expect(() => assertRefundAllowed(750_000n, 1_000_000n, 250_000n)).not.toThrow();
    expect(() => assertRefundAllowed(750_001n, 1_000_000n, 250_000n)).toThrow(MoneyError);
    expect(() => assertRefundAllowed(0n, 1_000_000n, 0n)).toThrow(MoneyError);
  });
});
