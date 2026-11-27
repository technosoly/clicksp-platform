import { describe, expect, it } from "vitest";
import { parseTarget, fitmentInputSchema, newSourceSchema } from "@/modules/compatibility/domain/fitment-input";
import { generationInputSchema, manufacturerInputSchema, parseModelYear, variantInputSchema, yearRange } from "../domain/vehicle-input";

const id = "0193e9c2-7a4b-7c3d-8e9f-0123456789ab";

describe("model years", () => {
  it("reads solar years as Jalali and stores Gregorian", () => {
    expect(parseModelYear("۱۳۹۸")).toBe(2019);
    expect(parseModelYear("1402")).toBe(2023);
    expect(parseModelYear("2019")).toBe(2019);
    expect(parseModelYear("")).toBeNull();
    expect(parseModelYear("98")).toBe("invalid");
    expect(parseModelYear("1700")).toBe("invalid");
    expect(parseModelYear("20x9")).toBe("invalid");
  });

  it("checks generation ranges", () => {
    expect(generationInputSchema.parse({ code: "", yearFrom: "1387", yearTo: "" })).toEqual({ code: null, yearFrom: 2008, yearTo: null });
    expect(generationInputSchema.safeParse({ code: "", yearFrom: "", yearTo: "" }).error?.issues[0]?.message).toBe("year_from_required");
    expect(generationInputSchema.safeParse({ code: "", yearFrom: "2015", yearTo: "2010" }).error?.issues[0]?.message).toBe("invalid_year_range");
    expect(yearRange(2008, 2015, "now")).toBe("2008–2015");
    expect(yearRange(2020, null, "now")).toBe("2020–now");
    expect(yearRange(2020, 2020, "now")).toBe("2020");
  });

  it("validates makers and engine versions", () => {
    const maker = manufacturerInputSchema.parse({ faName: "سازنده", faSlug: "", enName: "", enSlug: "", countryCode: "jp", isActive: true, sortOrder: "" });
    expect(maker).toMatchObject({ countryCode: "JP", sortOrder: 0, names: [{ locale: "fa", name: "سازنده" }] });
    expect(manufacturerInputSchema.safeParse({ faName: "x", faSlug: "", enName: "", enSlug: "", countryCode: "JPN", isActive: true, sortOrder: "" }).success).toBe(false);
    const base = { generationId: id, faName: "۱۲۵", enName: "", code: "", engineDisplacementCc: "۱۲۵", engineStroke: "", cylinders: "", cooling: "", fuelSystem: "injection", marketCode: "", yearFrom: "", yearTo: "", isActive: "on" };
    expect(variantInputSchema.parse(base)).toMatchObject({ engineDisplacementCc: 125, engineStroke: null, fuelSystem: "injection", isActive: true });
    expect(variantInputSchema.safeParse({ ...base, engineDisplacementCc: "6000" }).error?.issues[0]?.message).toBe("invalid_cc");
    expect(variantInputSchema.safeParse({ ...base, fuelSystem: "diesel" }).error?.issues[0]?.message).toBe("invalid_fuel");
  });
});

describe("fitment input", () => {
  it("parses the motorcycle picker value", () => {
    expect(parseTarget(`v:${id}`)).toEqual({ variantId: id });
    expect(parseTarget(`g:${id}`)).toEqual({ generationId: id });
    expect(parseTarget(`x:${id}`)).toBeNull();
    expect(parseTarget("v:not-an-id")).toBeNull();
  });

  it("validates years, quantity and sources", () => {
    const base = { target: `g:${id}`, yearFrom: "1390", yearTo: "1392", position: "front", quantity: "۲", notes: "", sourceId: "" };
    expect(fitmentInputSchema.parse(base)).toMatchObject({ yearFrom: 2011, yearTo: 2013, quantity: 2, sourceId: null });
    expect(fitmentInputSchema.safeParse({ ...base, quantity: "0" }).error?.issues[0]?.message).toBe("invalid_quantity");
    expect(fitmentInputSchema.safeParse({ ...base, target: "" }).error?.issues[0]?.message).toBe("motorcycle_required");
    expect(newSourceSchema.safeParse({ type: "oem_catalog", title: "Catalogue", reference: "", url: "https://example.com/a" }).success).toBe(true);
    expect(newSourceSchema.safeParse({ type: "oem_catalog", title: "Catalogue", reference: "", url: "javascript:alert(1)" }).success).toBe(false);
    expect(newSourceSchema.safeParse({ type: "rumour", title: "x", reference: "", url: "" }).success).toBe(false);
  });
});
