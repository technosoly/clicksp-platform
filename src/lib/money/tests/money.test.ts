import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  applyPercent,
  discountByAmount,
  discountByPercent,
  divideRounded,
  formatMoney,
  fromToman,
  MoneyError,
  multiply,
  parseMoneyInput,
  rial,
  roundToStep,
  toToman,
} from "..";

describe("rial()", () => {
  it("accepts bigint, safe integers and integer strings", () => {
    expect(rial(10n)).toBe(10n);
    expect(rial(1500)).toBe(1500n);
    expect(rial(" -250 ")).toBe(-250n);
  });

  it("rejects fractions and unsafe numbers", () => {
    expect(() => rial(1.5)).toThrow(MoneyError);
    expect(() => rial("12.5")).toThrow(MoneyError);
    expect(() => rial(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => rial(Number.NaN)).toThrow(MoneyError);
    expect(() => rial("1e6")).toThrow(MoneyError);
  });
});

describe("Rial to Toman", () => {
  it("splits whole Toman and the Rial remainder", () => {
    expect(toToman(12_340n)).toEqual({ whole: 1_234n, remainderRial: 0n });
    expect(toToman(12_345n)).toEqual({ whole: 1_234n, remainderRial: 5n });
    expect(toToman(0n)).toEqual({ whole: 0n, remainderRial: 0n });
  });

  it("handles amounts larger than 2^53 exactly", () => {
    const big = 2n ** 60n + 7n;
    const { whole, remainderRial } = toToman(big);
    expect(whole * 10n + remainderRial).toBe(big);
  });
});

describe("Toman to Rial", () => {
  it("converts whole Toman", () => {
    expect(fromToman(1_234n)).toBe(12_340n);
    expect(fromToman("1234")).toBe(12_340n);
  });

  it("converts one decimal digit exactly", () => {
    expect(fromToman("1234.5")).toBe(12_345n);
    expect(fromToman("-0.5")).toBe(-5n);
  });

  it("rejects values that are not exact in Rial", () => {
    expect(() => fromToman("1.25")).toThrow(MoneyError);
    expect(() => fromToman("abc")).toThrow(MoneyError);
  });

  it("round-trips with toToman", () => {
    for (const r of [0n, 9n, 10n, 12_345n, 999_999_999_999n]) {
      const { whole, remainderRial } = toToman(r);
      expect(fromToman(`${whole}.${remainderRial}`)).toBe(r);
    }
  });
});

describe("formatMoney", () => {
  it("formats Toman in Persian with Persian digits and separators", () => {
    expect(formatMoney(12_500_000n, { locale: "fa", unit: "toman" })).toBe("۱٬۲۵۰٬۰۰۰ تومان");
  });

  it("formats Rial in Persian", () => {
    expect(formatMoney(12_500_000n, { locale: "fa", unit: "rial" })).toBe("۱۲٬۵۰۰٬۰۰۰ ریال");
  });

  it("formats in English with ASCII digits", () => {
    expect(formatMoney(12_500_000n, { locale: "en", unit: "toman" })).toBe("1,250,000 Toman");
    expect(formatMoney(12_500_000n, { locale: "en", unit: "rial" })).toBe("12,500,000 Rial");
  });

  it("supports English digits in the Persian UI", () => {
    expect(formatMoney(1_000n, { locale: "fa", unit: "toman", digits: "en" })).toBe("100 تومان");
  });

  it("never drops Rial when showing Toman", () => {
    expect(formatMoney(12_345n, { locale: "en", unit: "toman" })).toBe("1,234.5 Toman");
    expect(formatMoney(12_345n, { locale: "fa", unit: "toman" })).toBe("۱٬۲۳۴٫۵ تومان");
  });

  it("formats zero, negatives (refunds) and very large values", () => {
    expect(formatMoney(0n, { locale: "en", unit: "toman" })).toBe("0 Toman");
    expect(formatMoney(-25_000n, { locale: "en", unit: "toman" })).toBe("-2,500 Toman");
    expect(formatMoney(10n ** 18n, { locale: "en", unit: "rial", label: false })).toBe(
      "1,000,000,000,000,000,000",
    );
  });
});

describe("parseMoneyInput", () => {
  it("parses Persian digits and separators", () => {
    expect(parseMoneyInput("۱٬۲۵۰٬۰۰۰", "toman")).toBe(12_500_000n);
    expect(parseMoneyInput("12,500,000", "rial")).toBe(12_500_000n);
    expect(parseMoneyInput("۱۲۳۴٫۵", "toman")).toBe(12_345n);
  });

  it("rejects decimals in Rial and empty input", () => {
    expect(() => parseMoneyInput("10.5", "rial")).toThrow(MoneyError);
    expect(() => parseMoneyInput("  ", "rial")).toThrow(MoneyError);
  });
});

describe("rounding", () => {
  it("divideRounded applies each mode, including negatives", () => {
    expect(divideRounded(15n, 10n, "half_up")).toBe(2n);
    expect(divideRounded(-15n, 10n, "half_up")).toBe(-2n);
    expect(divideRounded(25n, 10n, "half_even")).toBe(2n);
    expect(divideRounded(35n, 10n, "half_even")).toBe(4n);
    expect(divideRounded(19n, 10n, "down")).toBe(1n);
    expect(divideRounded(11n, 10n, "up")).toBe(2n);
    expect(divideRounded(20n, 10n, "up")).toBe(2n);
  });

  it("roundToStep rounds to a configured step", () => {
    expect(roundToStep(12_345n, 1_000n, "half_up")).toBe(12_000n);
    expect(roundToStep(12_500n, 1_000n, "half_up")).toBe(13_000n);
    expect(() => roundToStep(1n, 0n, "half_up")).toThrow(MoneyError);
  });
});

describe("discounts", () => {
  it("applies percentage discounts in basis points with explicit rounding", () => {
    expect(applyPercent(1_000_000n, 1_000, "half_up")).toBe(100_000n); // 10%
    expect(applyPercent(999n, 1_250, "half_up")).toBe(125n); // 124.875 -> 125
    expect(applyPercent(999n, 1_250, "down")).toBe(124n);
    expect(discountByPercent(999n, 1_250, "half_up")).toBe(874n);
  });

  it("never goes below zero and rejects invalid percentages", () => {
    expect(discountByPercent(5_000n, 10_000, "half_up")).toBe(0n);
    expect(discountByAmount(5_000n, 7_000n)).toBe(0n);
    expect(() => discountByPercent(5_000n, 10_001, "half_up")).toThrow(MoneyError);
    expect(() => discountByPercent(5_000n, 12.5, "half_up")).toThrow(MoneyError);
    expect(() => discountByAmount(5_000n, -1n)).toThrow(MoneyError);
  });
});

describe("arithmetic and allocation", () => {
  it("adds and multiplies by integer quantities only", () => {
    expect(add(1n, 2n, 3n)).toBe(6n);
    expect(multiply(125_000n, 3)).toBe(375_000n);
    expect(() => multiply(125_000n, 1.5)).toThrow(MoneyError);
  });

  it("allocates without losing a single Rial", () => {
    const parts = allocate(100n, [1n, 1n, 1n]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(add(...parts)).toBe(100n);

    const refund = allocate(-1_000n, [3n, 7n]);
    expect(refund).toEqual([-300n, -700n]);
  });

  it("rejects empty or zero weights", () => {
    expect(() => allocate(10n, [])).toThrow(MoneyError);
    expect(() => allocate(10n, [0n, 0n])).toThrow(MoneyError);
  });
});
