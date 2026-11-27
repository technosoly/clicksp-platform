import { describe, expect, it } from "vitest";
import { isProvinceCode, PROVINCES, provinceName } from "../domain/provinces";
import { rateCovers, shippingCost } from "../domain/quote";

const rate = { baseAmount: 300_000n, perKgAmount: 100_000n, freeAboveSubtotal: 5_000_000n, minWeightGrams: 0, maxWeightGrams: 10_000 };

describe("shipping cost", () => {
  it("adds the per-kg amount for every started kilogram", () => {
    expect(shippingCost(rate, 0, 1n)).toBe(300_000n);
    expect(shippingCost(rate, 1, 1n)).toBe(400_000n);
    expect(shippingCost(rate, 1000, 1n)).toBe(400_000n);
    expect(shippingCost(rate, 1001, 1n)).toBe(500_000n);
  });
  it("is free from the threshold on", () => {
    expect(shippingCost(rate, 5000, 4_999_999n)).toBe(800_000n);
    expect(shippingCost(rate, 5000, 5_000_000n)).toBe(0n);
  });
  it("applies only within the rate's weight band", () => {
    expect(rateCovers(rate, 10_000)).toBe(true);
    expect(rateCovers(rate, 10_001)).toBe(false);
    expect(rateCovers({ ...rate, minWeightGrams: 500 }, 499)).toBe(false);
  });
});

describe("provinces", () => {
  it("lists Iran's 31 provinces with unique codes", () => {
    expect(PROVINCES).toHaveLength(31);
    expect(new Set(PROVINCES.map((p) => p.code)).size).toBe(31);
    expect(isProvinceCode("IR-23")).toBe(true);
    expect(isProvinceCode("IR-99")).toBe(false);
    expect(provinceName("IR-10", "fa")).toBe("اصفهان");
  });
});
