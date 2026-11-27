import { describe, expect, it } from "vitest";
import { clampQuantity, lineProblem, MAX_LINE_QUANTITY } from "../domain/cart-rules";

describe("cart rules", () => {
  const variant = { minQty: 2, maxQty: 10 };
  it("names what stops a line from being ordered", () => {
    expect(lineProblem({ quantity: 3, variant: null, available: 5 })).toBe("unavailable");
    expect(lineProblem({ quantity: 3, variant, available: 0 })).toBe("out_of_stock");
    expect(lineProblem({ quantity: 1, variant, available: 5 })).toBe("below_minimum");
    expect(lineProblem({ quantity: 11, variant, available: 50 })).toBe("above_maximum");
    expect(lineProblem({ quantity: 6, variant, available: 5 })).toBe("not_enough_stock");
    expect(lineProblem({ quantity: 5, variant, available: 5 })).toBeNull();
  });
  it("keeps an add within the part's limits and the cart's", () => {
    expect(clampQuantity(1, variant)).toBe(2);
    expect(clampQuantity(40, variant)).toBe(10);
    expect(clampQuantity(500, { minQty: 1, maxQty: null })).toBe(MAX_LINE_QUANTITY);
    expect(clampQuantity(1, { minQty: 150, maxQty: null })).toBe(MAX_LINE_QUANTITY);
  });
});
