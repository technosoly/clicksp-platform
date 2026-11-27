/**
 * Product import from a CSV file (Phase 6): reading the file and checking
 * each row. Pure, no I/O: the service looks up categories, brands and SKUs
 * and passes them in.
 *
 * The file is UTF-8 CSV ("CSV UTF-8" in Excel), comma separated, with a
 * header row naming the columns below in any order. Unknown columns are an
 * error, so a typo never silently drops data. One row is one product with
 * its main variant; a SKU already in the catalog updates that product, and
 * an empty cell then keeps the current value.
 */
import { MoneyError, parseMoneyInput, type DisplayUnit } from "@/lib/money";
import { normalizeForStorage, normalizeIdentifier, toEnDigits } from "@/lib/persian-text";
import { identifierInputSchema, skuSchema } from "./catalog-input";

export const IMPORT_COLUMNS = [
  "sku",
  "title_fa",
  "title_en",
  "short_fa",
  "short_en",
  "category",
  "brand",
  "price",
  "compare_at_price",
  "warranty_months",
  "part_numbers",
  "status",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
const REQUIRED_COLUMNS: readonly ImportColumn[] = ["sku", "title_fa", "category", "price"];

export const IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, rows: 5000, cell: 2000, partNumbers: 20 } as const;

/** One row as read from the file: every column, "" when empty. */
export type ImportCells = Record<ImportColumn, string>;
export interface ImportFileRow {
  /** Line in the spreadsheet: the header is row 1, so data starts at row 2. */
  rowNumber: number;
  cells: ImportCells;
}

export type ImportFileError = "not_utf8" | "empty" | "malformed" | "too_many_rows" | "unknown_column" | "missing_column" | "duplicate_column";

/** Strict UTF-8 (a file saved in another encoding is refused, not misread). The BOM Excel adds is dropped. */
export function decodeCsv(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * RFC 4180 CSV: comma separated, fields in double quotes may hold commas,
 * line breaks and "" for a quote. Accepts CRLF, LF or CR line ends.
 * Returns null for a quote left open or text after a closing quote.
 */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
    } else if (afterQuote) {
      return null;
    } else if (c === '"' && field === "") {
      quoted = true;
    } else {
      field += c;
    }
  }
  if (quoted) return null;
  if (field !== "" || row.length > 0 || afterQuote) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isBlank = (cells: readonly string[]) => cells.every((c) => c.trim() === "");

/** Reads the whole file: header, then one entry per non-empty row. */
export function readImportFile(bytes: Uint8Array): { rows: ImportFileRow[] } | { error: ImportFileError; detail?: string } {
  const text = decodeCsv(bytes);
  if (text === null) return { error: "not_utf8" };
  const table = parseCsv(text);
  if (table === null) return { error: "malformed" };
  const headerIndex = table.findIndex((r) => !isBlank(r));
  if (headerIndex === -1) return { error: "empty" };
  const header = table[headerIndex]!.map((h) => h.trim().toLowerCase());
  const seen = new Set<string>();
  for (const name of header) {
    if (name === "") continue;
    if (!(IMPORT_COLUMNS as readonly string[]).includes(name)) return { error: "unknown_column", detail: name.slice(0, 50) };
    if (seen.has(name)) return { error: "duplicate_column", detail: name };
    seen.add(name);
  }
  const missing = REQUIRED_COLUMNS.find((c) => !seen.has(c));
  if (missing) return { error: "missing_column", detail: missing };

  const rows: ImportFileRow[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const raw = table[i]!;
    if (isBlank(raw)) continue;
    if (rows.length >= IMPORT_LIMITS.rows) return { error: "too_many_rows" };
    const cells = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ""])) as ImportCells;
    header.forEach((name, column) => {
      if (name !== "") cells[name as ImportColumn] = (raw[column] ?? "").trim().slice(0, IMPORT_LIMITS.cell);
    });
    rows.push({ rowNumber: i + 1, cells });
  }
  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

/** What the service knows about the catalog when it checks a row. */
export interface ImportLookups {
  unit: DisplayUnit;
  /** Category and brand ids by slug (Persian or English). */
  categoryBySlug: ReadonlyMap<string, string>;
  brandBySlug: ReadonlyMap<string, string>;
  /** Normalized SKU of an existing variant: its product and whether it is the product's main variant. */
  existingSku: ReadonlyMap<string, { productId: string; isDefault: boolean }>;
}

export interface CheckedRow {
  action: "create" | "update";
  sku: string;
  skuNormalized: string;
  productId: string | null;
  categoryId: string;
  brandId: string | null;
  price: bigint | null;
  compareAtPrice: bigint | null;
  warrantyMonths: number | null;
  partNumbers: { value: string; normalizedValue: string }[];
  status: "draft" | "active" | null;
}

const MAX_PRICE_RIAL = 10n ** 15n;

function money(input: string, unit: DisplayUnit): bigint | "invalid" {
  try {
    const value = parseMoneyInput(input, unit);
    return value <= 0n || value > MAX_PRICE_RIAL ? "invalid" : value;
  } catch (error) {
    if (error instanceof MoneyError) return "invalid";
    throw error;
  }
}

const slugKey = (value: string) => normalizeForStorage(value).toLowerCase();

/**
 * Checks one row against the catalog. Errors are translation keys under
 * AdminImports.rowErrors; every problem in the row is listed, so one pass
 * over the report fixes the file. A SKU already used by an earlier row of
 * the same file is an error (the later row would overwrite the earlier one).
 */
export function checkRow(cells: ImportCells, lookups: ImportLookups, skusInFile: Set<string>): { row: CheckedRow } | { errors: string[] } {
  const errors: string[] = [];
  const sku = skuSchema.safeParse(cells.sku);
  const skuNormalized = sku.success ? sku.data.skuNormalized : null;
  if (!sku.success) errors.push(cells.sku === "" ? "sku_required" : "invalid_sku");
  else if (skusInFile.has(sku.data.skuNormalized)) errors.push("duplicate_sku");
  const existing = skuNormalized ? lookups.existingSku.get(skuNormalized) : undefined;
  if (existing && !existing.isDefault) errors.push("sku_is_variant");
  const action: CheckedRow["action"] = existing ? "update" : "create";

  if (normalizeForStorage(cells.title_fa) === "") errors.push("title_fa_required");
  if (cells.title_fa.length > 250 || cells.title_en.length > 250) errors.push("title_too_long");
  if (cells.short_fa.length > 1000 || cells.short_en.length > 1000) errors.push("short_too_long");
  if (cells.short_en !== "" && cells.title_en === "" && action === "create") errors.push("title_en_required");

  const categoryId = lookups.categoryBySlug.get(slugKey(cells.category)) ?? null;
  if (cells.category === "") errors.push("category_required");
  else if (!categoryId) errors.push("unknown_category");
  const brandId = cells.brand === "" ? null : (lookups.brandBySlug.get(slugKey(cells.brand)) ?? null);
  if (cells.brand !== "" && !brandId) errors.push("unknown_brand");

  let price: bigint | null = null;
  if (cells.price === "") {
    if (action === "create") errors.push("price_required");
  } else {
    const value = money(cells.price, lookups.unit);
    if (value === "invalid") errors.push("invalid_price");
    else price = value;
  }
  let compareAtPrice: bigint | null = null;
  if (cells.compare_at_price !== "") {
    const value = money(cells.compare_at_price, lookups.unit);
    if (value === "invalid" || (price !== null && value <= price)) errors.push("invalid_compare_at");
    else compareAtPrice = value;
  }

  let warrantyMonths: number | null = null;
  if (cells.warranty_months !== "") {
    const value = Number(toEnDigits(cells.warranty_months));
    if (!Number.isInteger(value) || value < 0 || value > 240) errors.push("invalid_warranty");
    else warrantyMonths = value;
  }

  const partNumbers: CheckedRow["partNumbers"] = [];
  const values = cells.part_numbers.split("|").map((v) => v.trim()).filter((v) => v !== "");
  if (values.length > IMPORT_LIMITS.partNumbers) errors.push("too_many_part_numbers");
  for (const value of values.slice(0, IMPORT_LIMITS.partNumbers)) {
    const parsed = identifierInputSchema.safeParse({ type: "oem", value, brandId: "" });
    if (!parsed.success) {
      errors.push("invalid_part_number");
      break;
    }
    if (!partNumbers.some((p) => p.normalizedValue === parsed.data.normalizedValue)) {
      partNumbers.push({ value: parsed.data.value, normalizedValue: parsed.data.normalizedValue });
    }
  }

  const statusText = cells.status.toLowerCase();
  const status = statusText === "" ? null : statusText === "draft" || statusText === "active" ? statusText : "invalid";
  if (status === "invalid") errors.push("invalid_status");

  if (skuNormalized) skusInFile.add(skuNormalized);
  if (errors.length > 0 || !sku.success || !categoryId || status === "invalid") return { errors: [...new Set(errors)] };
  return {
    row: {
      action,
      sku: sku.data.sku,
      skuNormalized: sku.data.skuNormalized,
      productId: existing?.productId ?? null,
      categoryId,
      brandId,
      price,
      compareAtPrice,
      warrantyMonths,
      partNumbers,
      status,
    },
  };
}

/** The lookup form of a category or brand slug typed in the file. */
export { slugKey as importSlugKey };
/** Normalized part number, for matching against ones the product already has. */
export const partNumberKey = (value: string) => normalizeIdentifier(toEnDigits(value));
