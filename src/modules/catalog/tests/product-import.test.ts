import { describe, expect, it } from "vitest";
import { checkRow, decodeCsv, IMPORT_COLUMNS, parseCsv, readImportFile, type ImportCells, type ImportLookups } from "../domain/product-import";

const utf8 = (text: string) => new TextEncoder().encode(text);
const HEADER = "sku,title_fa,category,price";

const CAT = "0190a1a2-0000-7000-8000-000000000001";
const BRAND = "0190a1a2-0000-7000-8000-000000000002";
const PRODUCT = "0190a1a2-0000-7000-8000-000000000003";

const lookups: ImportLookups = {
  unit: "toman",
  categoryBySlug: new Map([["لنت-ترمز", CAT], ["brake-pads", CAT]]),
  brandBySlug: new Map([["acme", BRAND]]),
  existingSku: new Map([
    ["BP100", { productId: PRODUCT, isDefault: true }],
    ["BP100RED", { productId: PRODUCT, isDefault: false }],
  ]),
};

const cells = (over: Partial<ImportCells>): ImportCells => ({ ...(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ""])) as ImportCells), ...over });

describe("CSV reading", () => {
  it("parses quotes, commas, line breaks and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,"two\nlines",3\n')).toEqual([
      ["a", "b,c", 'd "q"'],
      ["1", "two\nlines", "3"],
    ]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv('a,"b')).toBeNull();
    expect(parseCsv('"a"b,c')).toBeNull();
    expect(parseCsv("a,b,c", 2)).toBe("too_wide");
    expect(parseCsv("a,b", 2)).toEqual([["a", "b"]]);
  });

  it("decodes only UTF-8 and drops the BOM", () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    // Windows-1256 "سلام" is not valid UTF-8.
    expect(decodeCsv(new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3]))).toBeNull();
  });

  it("maps columns by name in any order and numbers rows like the spreadsheet", () => {
    const file = readImportFile(utf8(`﻿Price, SKU ,title_fa,category\n100,BP-100,لنت,brake-pads\n\n200,BP-200,لنت ۲,brake-pads\n`));
    expect(file).toMatchObject({
      rows: [
        { rowNumber: 2, cells: { sku: "BP-100", price: "100", title_fa: "لنت", category: "brake-pads", brand: "" } },
        { rowNumber: 4, cells: { sku: "BP-200" } },
      ],
    });
  });

  it("refuses unknown, missing and repeated columns, empty files and too many rows", () => {
    expect(readImportFile(utf8(`${HEADER},colour\nx,y,z,1,red`))).toEqual({ error: "unknown_column", detail: "colour" });
    expect(readImportFile(utf8("sku,title_fa,price\nx,y,1"))).toEqual({ error: "missing_column", detail: "category" });
    expect(readImportFile(utf8(`${HEADER},sku\n`))).toEqual({ error: "duplicate_column", detail: "sku" });
    expect(readImportFile(utf8(`${HEADER}\n,,,\n`))).toEqual({ error: "empty" });
    expect(readImportFile(utf8(""))).toEqual({ error: "empty" });
    expect(readImportFile(utf8(`${HEADER}\n${"a,b,c,1\n".repeat(5001)}`))).toEqual({ error: "too_many_rows" });
    expect(readImportFile(new Uint8Array([0xff, 0xfe, 0x00]))).toEqual({ error: "not_utf8" });
    // A very wide line is refused while it is read, before any row work.
    expect(readImportFile(utf8(`${HEADER}${",".repeat(1_000_000)}\n${"x\n".repeat(5000)}`))).toEqual({ error: "too_many_columns" });
    expect(readImportFile(utf8(`${HEADER}\na,b,c,1${",".repeat(100)}\n`))).toEqual({ error: "too_many_columns" });
  });
});

describe("row checks", () => {
  it("accepts a new product, with price in the display unit and part numbers", () => {
    const result = checkRow(
      cells({ sku: "bp-200", title_fa: "لنت جلو", category: "لنت-ترمز", brand: "ACME", price: "۱۲۰٬۰۰۰", compare_at_price: "150000", warranty_months: "6", part_numbers: "45105-KPH-901 | 45105KPH901 | 06455-GB4", status: "Active" }),
      lookups,
      new Set(),
    );
    expect(result).toEqual({
      row: {
        action: "create",
        sku: "bp-200",
        skuNormalized: "BP200",
        productId: null,
        categoryId: CAT,
        brandId: BRAND,
        price: 1_200_000n,
        compareAtPrice: 1_500_000n,
        warrantyMonths: 6,
        partNumbers: [
          { value: "45105-KPH-901", normalizedValue: "45105KPH901" },
          { value: "06455-GB4", normalizedValue: "06455GB4" },
        ],
        status: "active",
      },
    });
  });

  it("updates an existing main product and lets cells stay empty", () => {
    const result = checkRow(cells({ sku: "BP 100", title_fa: "لنت", category: "brake-pads" }), lookups, new Set());
    expect(result).toMatchObject({ row: { action: "update", productId: PRODUCT, price: null, status: null } });
  });

  it("lists every problem in a row", () => {
    const result = checkRow(
      cells({ sku: "", title_fa: " ", category: "nowhere", brand: "nobody", price: "-5", warranty_months: "300", status: "archived", part_numbers: "--" }),
      lookups,
      new Set(),
    );
    expect(result).toEqual({
      errors: ["sku_required", "title_fa_required", "unknown_category", "unknown_brand", "invalid_price", "invalid_warranty", "invalid_part_number", "invalid_status"],
    });
    expect(checkRow(cells({ sku: "N1", title_fa: "x", category: "brake-pads" }), lookups, new Set())).toEqual({ errors: ["price_required"] });
    expect(checkRow(cells({ sku: "N1", title_fa: "x", category: "brake-pads", price: "100", compare_at_price: "100" }), lookups, new Set())).toEqual({ errors: ["invalid_compare_at"] });
    expect(checkRow(cells({ sku: "BP100", title_fa: "x", category: "brake-pads", compare_at_price: "100" }), lookups, new Set())).toEqual({ errors: ["price_required"] });
  });

  it("refuses a SKU repeated in the file and one that belongs to a product option", () => {
    const seen = new Set<string>();
    const row = cells({ sku: "N-1", title_fa: "x", category: "brake-pads", price: "100" });
    expect(checkRow(row, lookups, seen)).toHaveProperty("row");
    expect(checkRow({ ...row, sku: "n1" }, lookups, seen)).toEqual({ errors: ["duplicate_sku"] });
    expect(checkRow({ ...row, sku: "BP100-RED" }, lookups, new Set())).toEqual({ errors: ["sku_is_variant"] });
  });
});
