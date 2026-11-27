import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { addRate, createMethod, createZone, methodForAdmin, removeRate, shippingOverview, updateMethod, updateZone } from "@/modules/shipping/service/shipping-admin";
import { shippingQuoteFor, shippingQuotes } from "@/modules/shipping/service/shipping-quote";
import { actorFor, q } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const ok = <T extends { status: string }>(result: T): Extract<T, { status: "ok" }> => {
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
};

const code = () => `t_${uid().toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const method = (isActive = true) => ({ code: code(), kind: "courier", faName: "TEST پیک", enName: "TEST courier", faDescription: "", enDescription: "", minDays: "1", maxDays: "3", sortOrder: "", isActive });

describe("shipping settings", () => {
  it("are for Super and Business Admins only", async () => {
    for (const level of ["super_admin", "business_admin"] as const) {
      const actor = await actorFor(level);
      ok(await createZone(actor, { code: code(), faName: "TEST منطقه", enName: "", provinces: ["IR-23"], isActive: true }));
      await expect(shippingOverview(actor)).resolves.toBeDefined();
    }
    const staff = await actorFor("store_staff");
    await expect(shippingOverview(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(createMethod(staff, method())).rejects.toBeInstanceOf(AuthzError);
    await expect(createZone(staff, { code: code(), faName: "x", enName: "", provinces: ["IR-23"], isActive: true })).rejects.toBeInstanceOf(AuthzError);
    const ba = await actorFor("business_admin");
    const zone = ok(await createZone(ba, { code: code(), faName: "TEST منطقه", enName: "", provinces: ["IR-23"], isActive: true }));
    const m = ok(await createMethod(ba, method()));
    const rate = ok(await addRate(ba, m.id, { zoneId: zone.id, baseAmount: "1000", perKgAmount: "", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" }));
    await expect(updateZone(staff, zone.id, { code: code(), faName: "x", enName: "", provinces: ["IR-23"], isActive: true })).rejects.toBeInstanceOf(AuthzError);
    await expect(updateMethod(staff, m.id, method())).rejects.toBeInstanceOf(AuthzError);
    await expect(addRate(staff, m.id, { zoneId: zone.id, baseAmount: "1", perKgAmount: "", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" })).rejects.toBeInstanceOf(AuthzError);
    await expect(removeRate(staff, m.id, rate.id)).rejects.toBeInstanceOf(AuthzError);
    // A customer session is never an admin, whatever it holds.
    const customerActor = { ...ba, kind: "customer" as const };
    await expect(shippingOverview(customerActor)).rejects.toBeInstanceOf(AuthzError);
    await expect(removeRate(customerActor, m.id, rate.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("validates input and records each change in the audit log", async () => {
    const ba = await actorFor("business_admin");
    expect(await createZone(ba, { code: "Bad Code", faName: "x", enName: "", provinces: ["IR-23"], isActive: true })).toEqual({ status: "invalid", field: "invalid_code" });
    expect(await createZone(ba, { code: code(), faName: "x", enName: "", provinces: ["XX-99"], isActive: true })).toEqual({ status: "invalid", field: "provinces_required" });
    expect(await createMethod(ba, { ...method(), minDays: "5", maxDays: "2" })).toEqual({ status: "invalid", field: "invalid_days" });
    const m = ok(await createMethod(ba, method()));
    const again = method();
    expect(await createMethod(ba, { ...again, code: (await methodForAdmin(ba, m.id))!.method.code })).toEqual({ status: "taken" });
    const zone = ok(await createZone(ba, { code: code(), faName: "TEST منطقه", enName: "", provinces: ["IR-23"], isActive: true }));
    expect(await addRate(ba, m.id, { zoneId: zone.id, baseAmount: "abc", perKgAmount: "", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" })).toEqual({ status: "invalid", field: "invalid_amount" });
    const rate = ok(await addRate(ba, m.id, { zoneId: zone.id, baseAmount: "۵۰٬۰۰۰", perKgAmount: "", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" }));
    const [row] = await q<{ base: string }>("SELECT base_amount::text AS base FROM shipping_rates WHERE id = $1", [rate.id]);
    // Typed in Toman (the default display unit), stored in Rial.
    expect(row!.base).toBe("500000");
    const audits = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id IN ($1, $2, $3) ORDER BY id", [m.id, zone.id, rate.id]);
    expect(audits.map((a) => a.action)).toEqual(["shipping.method_created", "shipping.zone_created", "shipping.rate_created"]);
    ok(await removeRate(ba, m.id, rate.id));
    expect(await removeRate(ba, m.id, rate.id)).toEqual({ status: "not_found" });
  });

  it("quotes only on methods with a price in the province, by weight and order amount", async () => {
    const ba = await actorFor("business_admin");
    const zoneCode = code();
    const zone = ok(await createZone(ba, { code: zoneCode, faName: "TEST قم", enName: "TEST Qom", provinces: ["IR-25"], isActive: true }));
    const courier = ok(await createMethod(ba, method()));
    const off = ok(await createMethod(ba, method(false)));
    ok(await addRate(ba, courier.id, { zoneId: zone.id, baseAmount: "40000", perKgAmount: "5000", freeAbove: "2000000", minWeightGrams: "", maxWeightGrams: "10000" }));
    ok(await addRate(ba, off.id, { zoneId: zone.id, baseAmount: "1", perKgAmount: "", freeAbove: "", minWeightGrams: "", maxWeightGrams: "" }));

    const quotes = await shippingQuotes("en", "IR-25", 2500, 1_000_000n);
    const mine = quotes.filter((x) => [courier.id, off.id].includes(x.methodId));
    // 40,000 + 3 started kilograms × 5,000 Toman = 55,000 Toman = 550,000 Rial.
    expect(mine).toEqual([{ methodId: courier.id, name: "TEST courier", description: null, minDays: 1, maxDays: 3, cost: 550_000n }]);
    expect((await shippingQuoteFor(courier.id, "IR-25", 2500, 20_000_000n))?.cost).toBe(0n);
    expect(await shippingQuoteFor(courier.id, "IR-25", 12_000, 1n)).toBeNull();
    expect(await shippingQuoteFor(courier.id, "IR-23", 100, 1n)).toBeNull();
    expect(await shippingQuotes("fa", "nowhere", 100, 1n)).toEqual([]);

    // Switching the zone or method off removes the option.
    ok(await updateZone(ba, zone.id, { code: zoneCode, faName: "TEST قم", enName: "", provinces: ["IR-25"], isActive: false }));
    expect(await shippingQuoteFor(courier.id, "IR-25", 100, 1n)).toBeNull();
    ok(await updateZone(ba, zone.id, { code: zoneCode, faName: "TEST قم", enName: "", provinces: ["IR-25"], isActive: true }));
    const current = (await methodForAdmin(ba, courier.id))!.method;
    ok(await updateMethod(ba, courier.id, { ...method(false), code: current.code }));
    expect(await shippingQuoteFor(courier.id, "IR-25", 100, 1n)).toBeNull();
  });
});
