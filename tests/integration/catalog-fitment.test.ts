import { describe, expect, it } from "vitest";
import {
  createCategory,
  createGeneration,
  createMotorcycleVariant,
  createProduct,
  createSource,
  createUser,
  dbError,
  inTx,
  one,
  setActor,
} from "./helpers";

describe("catalog constraints", () => {
  it("keeps SKUs unique among active variants and frees them on soft delete", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const b = await createProduct(db);
      const sku = await one<{ sku_normalized: string }>(db, "SELECT sku_normalized FROM product_variants WHERE id = $1", [
        a.variantId,
      ]);
      const insertDup = `INSERT INTO product_variants (product_id, sku, sku_normalized, price) VALUES ($1, 'dup', $2, 1)`;
      expect((await dbError(db, insertDup, [b.productId, sku.sku_normalized]))?.constraint).toBe(
        "product_variants_sku_active",
      );
      await db.query("UPDATE product_variants SET deleted_at = now(), is_default = false WHERE id = $1", [a.variantId]);
      expect(await dbError(db, insertDup, [b.productId, sku.sku_normalized])).toBeNull();
    });
  });

  it("allows one default variant per product", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const err = await dbError(
        db,
        `INSERT INTO product_variants (product_id, sku, sku_normalized, price, is_default) VALUES ($1, 'x', 'TESTX1', 1, true)`,
        [a.productId],
      );
      expect(err?.constraint).toBe("product_variants_single_default");
    });
  });

  it("rejects negative prices, bad compare-at prices and unnormalized SKUs", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      expect((await dbError(db, "UPDATE product_variants SET price = -1 WHERE id = $1", [a.variantId]))?.constraint).toBe(
        "product_variants_price_non_negative",
      );
      expect(
        (await dbError(db, "UPDATE product_variants SET compare_at_price = price WHERE id = $1", [a.variantId]))?.constraint,
      ).toBe("product_variants_compare_at_gt_price");
      expect(
        (await dbError(db, "UPDATE product_variants SET sku_normalized = 'ab-12' WHERE id = $1", [a.variantId]))
          ?.constraint,
      ).toBe("product_variants_sku_normalized_format");
    });
  });

  it("stores prices above 2^53 exactly (BIGINT Rial)", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db, { price: 9_007_199_254_740_993n });
      const row = await one<{ price: string }>(db, "SELECT price::text AS price FROM product_variants WHERE id = $1", [
        a.variantId,
      ]);
      expect(row.price).toBe("9007199254740993");
    });
  });

  it("records every price change with the acting user, append-only", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      await setActor(db, user);
      const a = await createProduct(db, { price: 1_000_000n });
      await db.query("UPDATE product_variants SET price = 1200000 WHERE id = $1", [a.variantId]);
      await db.query("UPDATE product_variants SET weight_grams = 500 WHERE id = $1", [a.variantId]);
      const history = await db.query<{ price: string; changed_by: string }>(
        // Both rows share one transaction timestamp and UUIDv7 ids within the same
        // millisecond are not ordered, so order by the (increasing) price itself.
        "SELECT price::text AS price, changed_by FROM product_prices WHERE variant_id = $1 ORDER BY price",
        [a.variantId],
      );
      expect(history.rows).toEqual([
        { price: "1000000", changed_by: user },
        { price: "1200000", changed_by: user },
      ]);
      expect((await dbError(db, "UPDATE product_prices SET price = 1"))?.message).toMatch(/append-only/);
      expect((await dbError(db, "DELETE FROM product_prices"))?.message).toMatch(/append-only/);
    });
  });

  it("normalizes identifiers and keeps barcodes unique", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const b = await createProduct(db);
      const ins = `INSERT INTO product_identifiers (product_id, type, value, normalized_value) VALUES ($1, $2::identifier_type, $3, $4)`;
      expect((await dbError(db, ins, [a.productId, "oem", "12-ab 34", "12-ab 34"]))?.constraint).toBe(
        "product_identifiers_normalized_format",
      );
      await db.query(ins, [a.productId, "barcode", "6260000000001", "6260000000001"]);
      expect((await dbError(db, ins, [b.productId, "barcode", "6260000000001", "6260000000001"]))?.constraint).toBe(
        "product_identifiers_barcode_key",
      );
      // The same OEM number may appear on several products (genuine and alternatives).
      await db.query(ins, [a.productId, "oem", "۱۲۳-AB", "123AB"]);
      expect(await dbError(db, ins, [b.productId, "alternative_pn", "123-ab", "123AB"])).toBeNull();
      const found = await db.query("SELECT product_id FROM product_identifiers WHERE normalized_value = '123AB'");
      expect(found.rowCount).toBe(2);
    });
  });

  it("rejects category cycles and maintains depth", async () => {
    await inTx(async (db) => {
      const root = await createCategory(db);
      const child = await createCategory(db, root);
      const grandchild = await createCategory(db, child);
      expect((await dbError(db, "UPDATE categories SET parent_id = $1 WHERE id = $2", [grandchild, root]))?.message).toMatch(
        /own ancestor/,
      );
      const depths = async () =>
        (await db.query<{ depth: number }>("SELECT depth FROM categories WHERE id = ANY($1) ORDER BY depth", [[root, child, grandchild]])).rows.map((r) => r.depth);
      expect(await depths()).toEqual([0, 1, 2]);
      const otherRoot = await createCategory(db);
      const deeper = await createCategory(db, otherRoot);
      await db.query("UPDATE categories SET parent_id = $1 WHERE id = $2", [deeper, root]);
      const after = await db.query<{ id: string; depth: number }>("SELECT id, depth FROM categories WHERE id = ANY($1)", [
        [root, child, grandchild],
      ]);
      expect(Object.fromEntries(after.rows.map((r) => [r.id, r.depth]))).toEqual({ [root]: 2, [child]: 3, [grandchild]: 4 });
    });
  });

  it("checks attribute values against the attribute type", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const attr = await one<{ id: string }>(
        db,
        "INSERT INTO attribute_definitions (key, data_type, unit) VALUES ('test_thread_mm', 'number', 'mm') RETURNING id",
      );
      const ins = "INSERT INTO product_attributes (product_id, attribute_id, value_text, value_number) VALUES ($1, $2, $3, $4)";
      expect((await dbError(db, ins, [a.productId, attr.id, "M10", null]))?.message).toMatch(/does not match attribute type/);
      expect(await dbError(db, ins, [a.productId, attr.id, null, "10.5"])).toBeNull();
    });
  });

  it("rejects images and identifiers that point at another product's variant", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const b = await createProduct(db);
      const err = await dbError(
        db,
        "INSERT INTO product_identifiers (product_id, variant_id, type, value, normalized_value) VALUES ($1, $2, 'oem', 'X1', 'X1')",
        [a.productId, b.variantId],
      );
      expect(err?.message).toMatch(/does not belong to product/);
    });
  });

  it("rejects self relations", async () => {
    await inTx(async (db) => {
      const a = await createProduct(db);
      const err = await dbError(
        db,
        "INSERT INTO product_relations (product_id, related_product_id, type) VALUES ($1, $1, 'replacement')",
        [a.productId],
      );
      expect(err?.constraint).toBe("product_relations_not_self");
    });
  });
});

describe("motorcycle catalog and fitment", () => {
  it("validates generation and variant years", async () => {
    await inTx(async (db) => {
      const { modelId, generationId } = await createGeneration(db, 2015, 2020);
      expect(
        (await dbError(db, "INSERT INTO motorcycle_generations (model_id, year_from, year_to) VALUES ($1, 2020, 2015)", [modelId]))
          ?.constraint,
      ).toBe("motorcycle_generations_years");
      expect(
        (await dbError(db, "INSERT INTO motorcycle_variants (generation_id, year_from, year_to) VALUES ($1, 2014, 2016)", [generationId]))
          ?.message,
      ).toMatch(/outside its generation/);
      expect(
        await dbError(db, "INSERT INTO motorcycle_variants (generation_id, year_from, year_to) VALUES ($1, 2016, 2018)", [generationId]),
      ).toBeNull();
      // Narrowing the generation would strand that variant.
      expect((await dbError(db, "UPDATE motorcycle_generations SET year_to = 2017 WHERE id = $1", [generationId]))?.message).toMatch(
        /would exclude/,
      );
    });
  });

  it("links a product to many motorcycles and a motorcycle to many products", async () => {
    await inTx(async (db) => {
      const source = await createSource(db);
      const g1 = await createGeneration(db, 2010, 2015);
      const g2 = await createGeneration(db, 2016, null);
      const v1 = await createMotorcycleVariant(db, g1.generationId);
      const p1 = await createProduct(db);
      const p2 = await createProduct(db);
      const link = `INSERT INTO product_compatibilities (product_id, motorcycle_variant_id, motorcycle_generation_id, source_id)
                    VALUES ($1, $2, $3, $4)`;
      await db.query(link, [p1.productId, v1, null, source]);
      await db.query(link, [p1.productId, null, g2.generationId, source]);
      await db.query(link, [p2.productId, v1, null, source]);
      const byProduct = await db.query("SELECT 1 FROM product_compatibilities WHERE product_id = $1", [p1.productId]);
      const byBike = await db.query("SELECT 1 FROM product_compatibilities WHERE motorcycle_variant_id = $1", [v1]);
      expect(byProduct.rowCount).toBe(2);
      expect(byBike.rowCount).toBe(2);
      // Same claim twice is rejected.
      expect((await dbError(db, link, [p1.productId, v1, null, source]))?.constraint).toBe(
        "product_compatibilities_variant_key",
      );
    });
  });

  it("requires exactly one target, a source and years inside the generation", async () => {
    await inTx(async (db) => {
      const source = await createSource(db);
      const g = await createGeneration(db, 2010, 2015);
      const v = await createMotorcycleVariant(db, g.generationId);
      const p = await createProduct(db);
      expect(
        (await dbError(
          db,
          "INSERT INTO product_compatibilities (product_id, motorcycle_variant_id, motorcycle_generation_id, source_id) VALUES ($1, $2, $3, $4)",
          [p.productId, v, g.generationId, source],
        ))?.constraint,
      ).toBe("product_compatibilities_one_target");
      expect(
        (await dbError(db, "INSERT INTO product_compatibilities (product_id, motorcycle_generation_id) VALUES ($1, $2)", [
          p.productId,
          g.generationId,
        ]))?.code,
      ).toBe("23502"); // source_id NOT NULL
      expect(
        (await dbError(
          db,
          "INSERT INTO product_compatibilities (product_id, motorcycle_generation_id, year_from, year_to, source_id) VALUES ($1, $2, 2009, 2012, $3)",
          [p.productId, g.generationId, source],
        ))?.message,
      ).toMatch(/outside the motorcycle generation/);
    });
  });

  it("defaults to unverified, requires a verifier, and resets when a verified claim changes", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      const source = await createSource(db);
      const g = await createGeneration(db, 2010, 2015);
      const p = await createProduct(db);
      const row = await one<{ id: string; verification_status: string }>(
        db,
        "INSERT INTO product_compatibilities (product_id, motorcycle_generation_id, source_id) VALUES ($1, $2, $3) RETURNING id, verification_status",
        [p.productId, g.generationId, source],
      );
      expect(row.verification_status).toBe("unverified");
      expect(
        (await dbError(db, "UPDATE product_compatibilities SET verification_status = 'verified' WHERE id = $1", [row.id]))
          ?.constraint,
      ).toBe("product_compatibilities_verified_has_verifier");
      await db.query(
        "UPDATE product_compatibilities SET verification_status = 'verified', verified_by = $2, verified_at = now() WHERE id = $1",
        [row.id, user],
      );
      // Editing notes keeps the verification; editing the claim drops it.
      await db.query("UPDATE product_compatibilities SET notes = 'TEST' WHERE id = $1", [row.id]);
      expect((await one(db, "SELECT verification_status FROM product_compatibilities WHERE id = $1", [row.id])).verification_status).toBe(
        "verified",
      );
      await db.query("UPDATE product_compatibilities SET year_from = 2012 WHERE id = $1", [row.id]);
      expect(
        await one(db, "SELECT verification_status, verified_by FROM product_compatibilities WHERE id = $1", [row.id]),
      ).toEqual({ verification_status: "unverified", verified_by: null });
    });
  });

  it("uses the (motorcycle variant, status) index for fitment lookups", async () => {
    await inTx(async (db) => {
      await db.query("SET LOCAL enable_seqscan = off");
      const plan = await db.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT product_id FROM product_compatibilities
         WHERE motorcycle_variant_id = '00000000-0000-7000-8000-000000000000' AND verification_status = 'verified'`,
      );
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(
        /Index Scan using product_compatibilities_motorcycle_variant_id_verification_/,
      );
    });
  });
});
