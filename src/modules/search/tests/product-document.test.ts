import { describe, expect, it } from "vitest";
import { PRODUCT_INDEX_SETTINGS, productDocument } from "../domain/product-document";

describe("product search document", () => {
  it("holds public text only, with SKUs and part numbers deduplicated", () => {
    const doc = productDocument({
      id: "p1",
      publishedAt: new Date("2026-01-02T03:04:05Z"),
      fa: { title: "لنت ترمز", searchTitle: "لنت ترمز", brand: "برند" },
      en: { title: null, searchTitle: null, brand: null },
      skus: ["AB12", "AB12"],
      identifiers: ["123", "123", "456"],
    });
    expect(doc).toEqual({
      id: "p1",
      fa_title: "لنت ترمز",
      en_title: "",
      fa_search: "لنت ترمز",
      en_search: "",
      fa_brand: "برند",
      en_brand: "",
      skus: ["AB12"],
      identifiers: ["123", "456"],
      published_at: 1767323045,
    });
    expect(Object.keys(doc).some((k) => /price|cost|stock/.test(k))).toBe(false);
  });

  it("only returns ids from the engine and never forgives typos in part numbers", () => {
    expect(PRODUCT_INDEX_SETTINGS.displayedAttributes).toEqual(["id"]);
    expect(PRODUCT_INDEX_SETTINGS.typoTolerance.disableOnAttributes).toEqual(["skus", "identifiers"]);
  });
});
