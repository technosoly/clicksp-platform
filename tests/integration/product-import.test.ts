/**
 * Product import from CSV through the real services on PostgreSQL: the
 * dry run writes nothing, a confirmed import creates and updates products
 * as the confirming admin, a second run of the same file only updates, and
 * Store Staff are refused. Data is synthetic (TEST ...).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { createBrand } from "@/modules/catalog/service/brands";
import { createCategory } from "@/modules/catalog/service/categories";
import {
  cancelProductImport,
  confirmProductImport,
  getProductImport,
  listProductImports,
  processProductImports,
  uploadProductImport,
} from "@/modules/catalog/service/product-import";
import { createProduct } from "@/modules/catalog/service/products";
import { AuthzError } from "@/modules/rbac/service/authorize";
import { actorFor, q } from "./admin-actors";
import { uid } from "./helpers";

afterAll(async () => {
  await prisma().$disconnect();
});

const csv = (lines: string[]) => ({ name: "products.csv", type: "text/csv", bytes: new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`) });
const HEADER = "sku,title_fa,title_en,category,brand,price,compare_at_price,warranty_months,part_numbers,status";

async function catalog() {
  const ba = await actorFor("business_admin");
  const slug = `test-imp-${uid().toLowerCase()}`;
  const category = await createCategory(ba, { faName: `TEST دسته ${uid()}`, faSlug: "", enName: "Import test", enSlug: slug, parentId: "", isVehicleSystem: false, isActive: true, sortOrder: "0" });
  const brandSlug = `test-brand-${uid().toLowerCase()}`;
  const brand = await createBrand(ba, { faName: `TEST برند ${uid()}`, faSlug: "", enName: "Brand", enSlug: brandSlug, isGenuine: false, isActive: true, sortOrder: "" });
  if (category.status !== "ok" || brand.status !== "ok") throw new Error("fixtures");
  return { ba, slug, categoryId: category.id, brandSlug, brandId: brand.id };
}

async function job(id: string) {
  const [row] = await q<{ status: string; valid_rows: number; invalid_rows: number; applied_rows: number; dry_run_report: unknown }>(
    "SELECT status, valid_rows, invalid_rows, applied_rows, dry_run_report FROM data_import_jobs WHERE id = $1",
    [id],
  );
  return row!;
}

const productsBySku = (skus: string[]) =>
  q<{ sku: string; product_id: string; price: string; compare_at_price: string | null; status: string; brand_id: string | null; warranty_months: number | null }>(
    `SELECT v.sku, v.product_id, v.price::text, v.compare_at_price::text, p.status::text, p.brand_id, p.warranty_months
     FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ANY($1) ORDER BY v.sku`,
    [skus],
  );

describe("product import", () => {
  it("checks without writing, then creates and updates as the confirming admin; a second run only updates", async () => {
    const { ba, slug, categoryId, brandSlug, brandId } = await catalog();
    const tag = uid();
    const existing = await createProduct(ba, {
      faTitle: `TEST موجود ${tag}`, faSlug: "", faShort: "توضیح قدیمی", enTitle: "", enSlug: "", enShort: "",
      brandId: "", primaryCategoryId: categoryId, categoryIds: [], warrantyMonths: "3", sku: `EX-${tag}`, price: "50000", compareAtPrice: "",
    });
    if (existing.status !== "ok") throw new Error(JSON.stringify(existing));

    const file = csv([
      HEADER,
      `A-${tag},TEST لنت جلو ${tag},Front pads ${tag},${slug},${brandSlug},"120,000",150000,6,45105-K${tag}|45105K${tag},active`,
      `B-${tag},TEST لنت جلو ${tag},,${slug},,۹۰۰۰۰,,,,`,
      `EX-${tag},TEST موجود تازه ${tag},,${slug},${brandSlug},60000,,,,active`,
      `C-${tag},TEST بی‌دسته,,nowhere-${tag},,1000,,,,`,
      `A-${tag},TEST تکراری,,${slug},,1000,,,,`,
    ]);
    const uploaded = await uploadProductImport(ba, file);
    if (uploaded.status !== "ok") throw new Error(JSON.stringify(uploaded));
    expect((await job(uploaded.id)).status).toBe("uploaded");

    await processProductImports(20_000);
    expect(await job(uploaded.id)).toMatchObject({ status: "validated", valid_rows: 3, invalid_rows: 2, dry_run_report: { create: 2, update: 1, invalid: 2 } });
    // The dry run changed nothing in the catalog.
    expect((await productsBySku([`A-${tag}`, `B-${tag}`])).length).toBe(0);
    expect((await productsBySku([`EX-${tag}`]))[0]).toMatchObject({ price: "500000", status: "draft" });
    const report = await getProductImport(ba, uploaded.id);
    expect(report?.problems.map((p) => [p.rowNumber, p.errors])).toEqual([
      [5, ["unknown_category"]],
      [6, ["duplicate_sku"]],
    ]);

    expect(await confirmProductImport(ba, uploaded.id)).toEqual({ status: "ok", id: uploaded.id });
    expect(await confirmProductImport(ba, uploaded.id)).toEqual({ status: "not_allowed" });
    await processProductImports(30_000);
    expect(await job(uploaded.id)).toMatchObject({ status: "completed", applied_rows: 3 });

    const rows = await productsBySku([`A-${tag}`, `B-${tag}`, `EX-${tag}`]);
    expect(rows).toEqual([
      expect.objectContaining({ sku: `A-${tag}`, price: "1200000", compare_at_price: "1500000", status: "active", brand_id: brandId, warranty_months: 6 }),
      expect.objectContaining({ sku: `B-${tag}`, price: "900000", status: "draft", brand_id: null }),
      expect.objectContaining({ sku: `EX-${tag}`, product_id: existing.id, price: "600000", status: "active", brand_id: brandId, warranty_months: 3 }),
    ]);
    // Same title twice: the second product's address gets its SKU.
    const slugs = await q<{ slug: string }>("SELECT slug FROM product_translations WHERE product_id = ANY($1) AND locale = 'fa' ORDER BY slug", [[rows[0]!.product_id, rows[1]!.product_id]]);
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
    const parts = await q<{ normalized_value: string }>("SELECT normalized_value FROM product_identifiers WHERE product_id = $1", [rows[0]!.product_id]);
    expect(parts.map((p) => p.normalized_value)).toEqual([`45105K${tag}`]);
    const [kept] = await q<{ short_description: string; title: string }>("SELECT title, short_description FROM product_translations WHERE product_id = $1 AND locale = 'fa'", [existing.id]);
    expect(kept).toEqual({ title: `TEST موجود تازه ${tag}`, short_description: "توضیح قدیمی" });
    // Every change is audited as the admin who confirmed, from the background job.
    const audits = await q<{ action: string; actor_user_id: string; user_agent: string }>(
      "SELECT action, actor_user_id, user_agent FROM audit_logs WHERE entity_id = $1 ORDER BY seq",
      [rows[0]!.product_id],
    );
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["product.created", "product.identifier_added", "product.published"]));
    expect(audits.every((a) => a.actor_user_id === ba.userId && a.user_agent === "background job")).toBe(true);
    const [completed] = await q<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE entity_id = $1 AND action IN ('import.uploaded', 'import.confirmed', 'import.completed')", [uploaded.id]);
    expect(Number(completed!.n)).toBe(3);

    // The same file again: nothing new is created, the products are updated.
    const again = await uploadProductImport(ba, file);
    if (again.status !== "ok") throw new Error("upload");
    await processProductImports(20_000);
    expect((await job(again.id)).dry_run_report).toEqual({ create: 0, update: 3, invalid: 2 });
    await confirmProductImport(ba, again.id);
    await processProductImports(30_000);
    expect(await job(again.id)).toMatchObject({ status: "completed", applied_rows: 3 });
    const [count] = await q<{ n: string }>("SELECT count(*) AS n FROM product_variants WHERE sku = ANY($1)", [[`A-${tag}`, `B-${tag}`, `EX-${tag}`]]);
    expect(Number(count!.n)).toBe(3);
  });

  it("reports an unusable file and lets an import be cancelled", async () => {
    const { ba } = await catalog();
    const bad = await uploadProductImport(ba, csv(["sku,title_fa,price", "X,Y,1"]));
    const latin = await uploadProductImport(ba, { name: "old.csv", type: "text/csv", bytes: new Uint8Array([0x73, 0x6b, 0x75, 0x0a, 0xd3, 0xe1]) });
    if (bad.status !== "ok" || latin.status !== "ok") throw new Error("upload");
    await processProductImports(20_000);
    expect(await job(bad.id)).toMatchObject({ status: "failed", dry_run_report: { error: "missing_column", detail: "category" } });
    expect(await job(latin.id)).toMatchObject({ status: "failed", dry_run_report: { error: "not_utf8" } });
    expect(await confirmProductImport(ba, bad.id)).toEqual({ status: "not_allowed" });

    const ok = await uploadProductImport(ba, csv([HEADER, `Z-${uid()},TEST,,nowhere,,1000,,,,`]));
    if (ok.status !== "ok") throw new Error("upload");
    await processProductImports(20_000);
    // Nothing valid: there is nothing to confirm, only to cancel.
    expect(await confirmProductImport(ba, ok.id)).toEqual({ status: "not_allowed" });
    expect(await cancelProductImport(ba, ok.id)).toEqual({ status: "ok", id: ok.id });
    expect((await job(ok.id)).status).toBe("cancelled");

    expect(await uploadProductImport(ba, { name: "x.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array([1]) })).toEqual({ status: "invalid", field: "not_csv" });
    expect(await uploadProductImport(ba, { name: "big.csv", type: "text/csv", bytes: new Uint8Array(2 * 1024 * 1024 + 1) })).toEqual({ status: "invalid", field: "file_too_large" });
  });

  it("stops an import whose confirming admin lost the permission", async () => {
    const { ba, slug } = await catalog();
    const uploaded = await uploadProductImport(ba, csv([HEADER, `L-${uid()},TEST,,${slug},,1000,,,,`]));
    if (uploaded.status !== "ok") throw new Error("upload");
    await processProductImports(20_000);
    await confirmProductImport(ba, uploaded.id);
    await q("UPDATE users SET status = 'disabled' WHERE id = $1", [ba.userId]);
    await processProductImports(20_000);
    expect(await job(uploaded.id)).toMatchObject({ status: "failed", dry_run_report: { error: "confirmer_not_allowed" } });
  });

  it("refuses Store Staff and customers", async () => {
    const staff = await actorFor("store_staff");
    await expect(uploadProductImport(staff, csv([HEADER]))).rejects.toBeInstanceOf(AuthzError);
    await expect(listProductImports(staff)).rejects.toBeInstanceOf(AuthzError);
    await expect(getProductImport(staff, "0190a1a2-0000-7000-8000-000000000001")).rejects.toBeInstanceOf(AuthzError);
    await expect(confirmProductImport(staff, "0190a1a2-0000-7000-8000-000000000001")).rejects.toBeInstanceOf(AuthzError);
    const customer = { ...(await actorFor("business_admin")), kind: "customer" as const };
    await expect(uploadProductImport(customer, csv([HEADER]))).rejects.toBeInstanceOf(AuthzError);
  });
});
