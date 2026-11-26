import { describe, expect, it } from "vitest";
import {
  normalizeForSearch,
  normalizeForStorage,
  normalizeIdentifier,
  searchVariants,
  toEnDigits,
  toFaDigits,
} from "..";

describe("digits", () => {
  it("converts Persian and Arabic-Indic digits to ASCII", () => {
    expect(toEnDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(toEnDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toEnDigits("abc ۱۲3")).toBe("abc 123");
  });

  it("converts ASCII digits to Persian for display", () => {
    expect(toFaDigits("2026-11-26")).toBe("۲۰۲۶-۱۱-۲۶");
  });
});

describe("normalizeForSearch", () => {
  it("maps Arabic Yeh and Kaf to Persian", () => {
    expect(normalizeForSearch("كيت")).toBe("کیت");
    expect(normalizeForSearch("موتورسيكلت")).toBe("موتورسیکلت");
    expect(normalizeForSearch("ى")).toBe("ی");
  });

  it("removes diacritics and tatweel", () => {
    expect(normalizeForSearch("لـــنت")).toBe("لنت");
    expect(normalizeForSearch("مُوتُور")).toBe("موتور");
  });

  it("maps Teh Marbuta and Heh with Yeh above to Heh", () => {
    expect(normalizeForSearch("ة")).toBe("ه");
    expect(normalizeForSearch("خانۀ")).toBe("خانه");
  });

  it("removes half-spaces, collapses whitespace and lowercases Latin", () => {
    expect(normalizeForSearch("  لنت‌ترمز   CG 125 ")).toBe("لنتترمز cg 125");
  });

  it("is idempotent", () => {
    const once = normalizeForSearch("فيلتر روغن ۱۲۵");
    expect(normalizeForSearch(once)).toBe(once);
  });
});

describe("searchVariants", () => {
  it("returns joined and spaced forms for half-spaced words", () => {
    expect(searchVariants("می‌خواهم")).toEqual(["میخواهم", "می خواهم"]);
  });

  it("returns a single form when there is no half-space", () => {
    expect(searchVariants("پیستون")).toEqual(["پیستون"]);
  });
});

describe("normalizeForStorage", () => {
  it("fixes Arabic letters but keeps ZWNJ, digits and case", () => {
    expect(normalizeForStorage(" لنت‌ترمز  جلو CG ۱۲۵ ")).toBe("لنت‌ترمز جلو CG ۱۲۵");
    expect(normalizeForStorage("كيلومتر")).toBe("کیلومتر");
  });
});

describe("normalizeIdentifier", () => {
  it("normalizes OEM numbers typed with Persian digits and separators", () => {
    expect(normalizeIdentifier("۱۲۳-ab 45")).toBe("123AB45");
    expect(normalizeIdentifier("06455-KPH-900")).toBe("06455KPH900");
    expect(normalizeIdentifier("a.b/c_d")).toBe("ABCD");
  });

  it("matches the same part number typed in different ways", () => {
    expect(normalizeIdentifier("۰۶۴۵۵ kph ۹۰۰")).toBe(normalizeIdentifier("06455-KPH-900"));
  });
});
