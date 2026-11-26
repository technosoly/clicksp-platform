import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  identifierInputSchema,
  parsePriceChange,
  productDetailsSchema,
  publishProblems,
  skuSchema,
  slugify,
  SLUG_PATTERN,
} from "../domain/catalog-input";

const UUID = "0193a4b2-0000-7000-8000-000000000001";
const UUID2 = "0193a4b2-0000-7000-8000-000000000002";

describe("slugify", () => {
  it.each([
    ["لنت ترمز‌جلو CG-125", "لنت-ترمز-جلو-cg-125"],
    ["  Brake  Pads (Front) ", "brake-pads-front"],
    ["فیلتر روغن ۱۲۵", "فیلتر-روغن-125"],
    ["كاربراتور يدكي", "کاربراتور-یدکی"],
    ["روغن، موتور؟", "روغن-موتور"],
    ["---", ""],
  ])("%s -> %s", (input, slug) => {
    expect(slugify(input)).toBe(slug);
    if (slug) expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
});

describe("category and product input", () => {
  it("requires the Persian name and derives slugs; English is optional", () => {
    const parsed = categoryInputSchema.parse({ faName: " ترمز ", faSlug: "", enName: "", enSlug: "", parentId: "", isVehicleSystem: "on", isActive: true, sortOrder: "۵" });
    expect(parsed).toEqual({
      parentId: null,
      isVehicleSystem: true,
      isActive: true,
      sortOrder: 5,
      names: [{ locale: "fa", name: "ترمز", slug: "ترمز", searchName: "ترمز" }],
    });
    expect(categoryInputSchema.safeParse({ faName: "", faSlug: "", enName: "Brakes", enSlug: "", parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "" }).error?.issues[0]?.message).toBe(
      "fa_name_required",
    );
    expect(categoryInputSchema.safeParse({ faName: "x", faSlug: "", enName: "", enSlug: "", parentId: "nope", isVehicleSystem: false, isActive: true, sortOrder: "" }).error?.issues[0]?.message).toBe(
      "invalid_parent",
    );
  });

  it("puts the primary category first in the category list and dedupes", () => {
    const parsed = productDetailsSchema.parse({
      faTitle: "لنت",
      faSlug: "",
      faShort: "",
      enTitle: "Pads",
      enSlug: "",
      enShort: "",
      brandId: "",
      primaryCategoryId: UUID,
      categoryIds: [UUID2, UUID],
      warrantyMonths: "۶",
    });
    expect(parsed.categoryIds).toEqual([UUID, UUID2]);
    expect(parsed.warrantyMonths).toBe(6);
    expect(parsed.texts.map((t) => t.slug)).toEqual(["لنت", "pads"]);
    expect(
      productDetailsSchema.safeParse({ faTitle: "x", faSlug: "", faShort: "", enTitle: "", enSlug: "", enShort: "only english text", brandId: "", primaryCategoryId: UUID, categoryIds: [], warrantyMonths: "" }).error
        ?.issues[0]?.message,
    ).toBe("en_title_required");
  });
});

describe("SKU, prices, identifiers", () => {
  it("normalizes SKUs for lookup", () => {
    expect(skuSchema.parse(" cg-125/۰۱ ")).toEqual({ sku: "cg-125/01", skuNormalized: "CG12501" });
    expect(skuSchema.safeParse("--").success).toBe(false);
  });

  it("parses prices in the display unit to integer Rial", () => {
    expect(parsePriceChange({ price: "۱۲۵٬۰۰۰", compareAtPrice: "" }, "toman")).toEqual({ price: 1_250_000n, compareAtPrice: null });
    expect(parsePriceChange({ price: "1250.5", compareAtPrice: "1300" }, "toman")).toEqual({ price: 12_505n, compareAtPrice: 13_000n });
    expect(parsePriceChange({ price: "125000", compareAtPrice: "" }, "rial")).toEqual({ price: 125_000n, compareAtPrice: null });
    expect(parsePriceChange({ price: "0", compareAtPrice: "" }, "toman")).toEqual({ error: "invalid_price" });
    expect(parsePriceChange({ price: "1.25", compareAtPrice: "" }, "toman")).toEqual({ error: "invalid_price" });
    expect(parsePriceChange({ price: "-5", compareAtPrice: "" }, "toman")).toEqual({ error: "invalid_price" });
    expect(parsePriceChange({ price: "100", compareAtPrice: "100" }, "toman")).toEqual({ error: "invalid_compare_at" });
    expect(parsePriceChange({ price: "abc", compareAtPrice: "" }, "toman")).toEqual({ error: "invalid_price" });
  });

  it("normalizes part numbers and checks barcodes", () => {
    expect(identifierInputSchema.parse({ type: "oem", value: "۱۲۳-ab 45", brandId: "" })).toEqual({ type: "oem", value: "123-ab 45", normalizedValue: "123AB45", brandId: null });
    expect(identifierInputSchema.safeParse({ type: "barcode", value: "12AB", brandId: "" }).error?.issues[0]?.message).toBe("invalid_barcode");
    expect(identifierInputSchema.safeParse({ type: "sku", value: "1", brandId: "" }).success).toBe(false);
  });

  it("a product can be published only with an active, priced main variant", () => {
    expect(publishProblems({ variants: [] })).toEqual(["no_active_variant"]);
    expect(publishProblems({ variants: [{ isDefault: true, isActive: true, price: 0n }] })).toEqual(["no_price"]);
    expect(publishProblems({ variants: [{ isDefault: true, isActive: false, price: 5n }] })).toEqual(["no_active_variant"]);
    expect(publishProblems({ variants: [{ isDefault: true, isActive: true, price: 5n }] })).toEqual([]);
  });
});
