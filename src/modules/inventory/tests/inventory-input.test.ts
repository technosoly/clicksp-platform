import { describe, expect, it } from "vitest";
import { available, locationInputSchema, movementInputSchema, warehouseInputSchema } from "../domain/inventory-input";

const V = "0193e9c2-7a4b-7c3d-8e9f-0123456789ab";

describe("inventory input", () => {
  it("normalizes warehouse and location codes and refuses bad ones", () => {
    const w = warehouseInputSchema.parse({ code: " tehran-۱ ", name: " انبار ", city: "", address: "", phone: "۰۲۱ ۱۲۳۴-۵۶۷۸", priority: "", isActive: "on" });
    expect(w).toMatchObject({ code: "TEHRAN-1", city: null, phone: "02112345678", priority: 100, isActive: true });
    expect(warehouseInputSchema.safeParse({ code: "a b", name: "x", city: "", address: "", phone: "", priority: "", isActive: true }).error?.issues[0]?.message).toBe("invalid_code");
    expect(warehouseInputSchema.safeParse({ code: "A", name: "x", city: "", address: "", phone: "", priority: "1001", isActive: true }).error?.issues[0]?.message).toBe("invalid_priority");
    expect(locationInputSchema.parse({ code: "a-01.2", description: "", isDefault: false, isActive: true }).code).toBe("A-01.2");
  });

  it("requires a reason to issue and an adjustment reason to adjust; quantities are whole and positive", () => {
    const base = { variantId: V, locationId: V, quantity: "۳", reference: "", reason: "", adjustmentReason: "" };
    expect(movementInputSchema.parse({ ...base, kind: "receive" }).quantity).toBe(3);
    expect(movementInputSchema.safeParse({ ...base, kind: "issue" }).error?.issues[0]?.message).toBe("reason_required");
    expect(movementInputSchema.safeParse({ ...base, kind: "adjust_plus" }).error?.issues[0]?.message).toBe("adjustment_reason_required");
    expect(movementInputSchema.safeParse({ ...base, kind: "adjust_plus", adjustmentReason: "stolen" }).error?.issues[0]?.message).toBe("invalid_adjustment_reason");
    for (const quantity of ["0", "-1", "1.5", "1000001", ""]) {
      expect(movementInputSchema.safeParse({ ...base, kind: "receive", quantity }).success).toBe(false);
    }
    expect(movementInputSchema.safeParse({ ...base, kind: "sale" }).success).toBe(false);
  });

  it("available stock is on hand minus reserved, never negative", () => {
    expect(available({ onHand: 5, reserved: 2 })).toBe(3);
    expect(available({ onHand: 2, reserved: 2 })).toBe(0);
  });
});
