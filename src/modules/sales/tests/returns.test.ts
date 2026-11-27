import { describe, expect, it } from "vitest";
import { returnableQuantities, returnValue, withinReturnWindow } from "../domain/returns";

describe("return rules", () => {
  it("allows returns for seven days after delivery", () => {
    const delivered = new Date("2026-11-01T10:00:00Z");
    expect(withinReturnWindow(delivered, new Date("2026-11-08T10:00:00Z"))).toBe(true);
    expect(withinReturnWindow(delivered, new Date("2026-11-08T10:00:01Z"))).toBe(false);
  });

  it("counts what is left to return per line", () => {
    const left = returnableQuantities(
      [
        { id: "a", quantity: 3 },
        { id: "b", quantity: 1 },
      ],
      [
        { orderItemId: "a", quantity: 1 },
        { orderItemId: "a", quantity: 1 },
        { orderItemId: "b", quantity: 1 },
      ],
    );
    expect(left).toEqual(new Map([["a", 1], ["b", 0]]));
  });

  it("values returned units at what the customer paid per unit, rounded down", () => {
    expect(returnValue([{ lineTotal: 1_000_000n, ordered: 3, returned: 2 }])).toBe(666_666n);
    expect(returnValue([{ lineTotal: 500n, ordered: 1, returned: 1 }, { lineTotal: 900n, ordered: 2, returned: 0 }])).toBe(500n);
  });
});
