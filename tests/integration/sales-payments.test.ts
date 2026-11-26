import { describe, expect, it } from "vitest";
import { commitCheck, createOrder, createProduct, createUser, dbError, inTx, one, setActor, type Db } from "./helpers";

async function setStatus(db: Db, orderId: string, status: string) {
  return dbError(db, "UPDATE orders SET status = $2::order_status WHERE id = $1", [orderId, status]);
}

async function provider(db: Db): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "INSERT INTO payment_providers (code, adapter_key) VALUES ('test_gateway', 'test') RETURNING id",
    )
  ).id;
}

describe("orders", () => {
  it("accepts an order whose totals match its items", async () => {
    await inTx(async (db) => {
      await createOrder(db);
      expect(await commitCheck(db)).toBeNull();
    });
  });

  it("rejects an order whose subtotal or discount does not match its items", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const order = await one<{ id: string }>(
        db,
        `INSERT INTO orders (subtotal, discount_total, shipping_total, tax_total, grand_total, customer_name, customer_phone)
         VALUES (1000000, 0, 0, 0, 1000000, 'TEST', '+989000000000') RETURNING id`,
      );
      await db.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, title_fa, snapshot, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, 'S', 'T', '{}', 1, 900000, 900000)`,
        [order.id, p.productId, p.variantId],
      );
      expect((await commitCheck(db))?.message).toMatch(/totals do not match/);
    });
  });

  it("rejects an order without items", async () => {
    await inTx(async (db) => {
      await db.query(
        `INSERT INTO orders (subtotal, grand_total, customer_name, customer_phone) VALUES (0, 0, 'TEST', '+989000000000')`,
      );
      expect((await commitCheck(db))?.message).toMatch(/has no items/);
    });
  });

  it("enforces the grand total and line total formulas", async () => {
    await inTx(async (db) => {
      expect(
        (await dbError(
          db,
          `INSERT INTO orders (subtotal, discount_total, shipping_total, tax_total, grand_total, customer_name, customer_phone)
           VALUES (100, 10, 5, 0, 100, 'TEST', '+989000000000')`,
        ))?.constraint,
      ).toBe("orders_grand_total_formula");
      const { orderId, product } = await createOrder(db);
      expect(
        (await dbError(
          db,
          `INSERT INTO order_items (order_id, product_id, variant_id, sku, title_fa, snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, 'S', 'T', '{}', 2, 100, 150)`,
          [orderId, product.productId, product.variantId],
        ))?.constraint,
      ).toBe("order_items_line_total_formula");
    });
  });

  it("follows the order state machine and logs every change with the actor", async () => {
    await inTx(async (db) => {
      const admin = await createUser(db);
      const { orderId } = await createOrder(db);
      expect((await setStatus(db, orderId, "shipped"))?.message).toMatch(/cannot change from pending_payment to shipped/);
      await setActor(db, admin);
      await db.query("SELECT set_config('app.status_reason', 'TEST payment verified', true)");
      for (const status of ["paid", "processing", "shipped", "delivered"]) {
        expect(await setStatus(db, orderId, status)).toBeNull();
      }
      expect((await setStatus(db, orderId, "pending_payment"))?.message).toMatch(/cannot change/);
      const history = await db.query<{ from_status: string | null; to_status: string; actor_user_id: string | null }>(
        "SELECT from_status, to_status, actor_user_id FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id",
        [orderId],
      );
      expect(history.rows.map((h) => [h.from_status, h.to_status])).toEqual([
        [null, "pending_payment"],
        ["pending_payment", "paid"],
        ["paid", "processing"],
        ["processing", "shipped"],
        ["shipped", "delivered"],
      ]);
      expect(history.rows.slice(1).every((h) => h.actor_user_id === admin)).toBe(true);
      expect((await one(db, "SELECT paid_at IS NOT NULL AS paid FROM orders WHERE id = $1", [orderId])).paid).toBe(true);
      expect((await dbError(db, "DELETE FROM order_status_history"))?.message).toMatch(/append-only/);
      expect((await dbError(db, "DELETE FROM orders WHERE id = $1", [orderId]))?.message).toMatch(/cannot be deleted/);
    });
  });

  it("freezes amounts and items once the order is paid", async () => {
    await inTx(async (db) => {
      const { orderId, itemId, product } = await createOrder(db);
      expect(await setStatus(db, orderId, "paid")).toBeNull();
      expect((await dbError(db, "UPDATE orders SET shipping_total = 0, grand_total = 900000 WHERE id = $1", [orderId]))?.message).toMatch(
        /frozen/,
      );
      expect((await dbError(db, "UPDATE order_items SET unit_price = 1 WHERE id = $1", [itemId]))?.message).toMatch(/immutable/);
      expect((await dbError(db, "DELETE FROM order_items WHERE id = $1", [itemId]))?.message).toMatch(/immutable/);
      expect(
        (await dbError(
          db,
          `INSERT INTO order_items (order_id, product_id, variant_id, sku, title_fa, snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, 'S', 'T', '{}', 1, 1, 1)`,
          [orderId, product.productId, product.variantId],
        ))?.message,
      ).toMatch(/awaits payment/);
    });
  });

  it("keeps the order line snapshot when the product changes", async () => {
    await inTx(async (db) => {
      const { orderId, product } = await createOrder(db);
      await db.query("UPDATE product_variants SET price = 1 WHERE id = $1", [product.variantId]);
      await db.query("UPDATE product_translations SET title = 'CHANGED' WHERE product_id = $1", [product.productId]);
      const item = await one(db, "SELECT unit_price::text AS unit_price, title_fa FROM order_items WHERE order_id = $1", [orderId]);
      expect(item).toEqual({ unit_price: "500000", title_fa: "TEST-ITEM" });
    });
  });

  it("never refunds more than the order total", async () => {
    await inTx(async (db) => {
      const admin = await createUser(db);
      const { orderId } = await createOrder(db); // grand_total 950,000
      const refund = (amount: number, key: string) =>
        dbError(
          db,
          `INSERT INTO order_refunds (order_id, amount, method, reason, idempotency_key, created_by)
           VALUES ($1, $2, 'gateway', 'TEST', $3, $4)`,
          [orderId, amount, key, admin],
        );
      expect(await refund(600_000, "r1")).toBeNull();
      // Idempotency key: the same refund request cannot be recorded twice.
      expect((await refund(1, "r1"))?.constraint).toBe("order_refunds_idempotency_key_key");
      expect((await refund(400_000, "r2"))?.message).toMatch(/would exceed the order total/);
      expect(await refund(350_000, "r3")).toBeNull();
      // A failed refund frees its amount.
      await db.query("UPDATE order_refunds SET status = 'failed' WHERE idempotency_key = 'r1'");
      expect(await refund(600_000, "r4")).toBeNull();
      expect((await dbError(db, "UPDATE order_refunds SET status = 'pending' WHERE idempotency_key = 'r1'"))?.message).toMatch(
        /already failed/,
      );
    });
  });

  it("never returns more than was ordered", async () => {
    await inTx(async (db) => {
      const { orderId, itemId } = await createOrder(db); // quantity 2
      const ret = async () =>
        (await one<{ id: string }>(db, "INSERT INTO order_returns (order_id, reason) VALUES ($1, 'defective') RETURNING id", [orderId]))
          .id;
      const first = await ret();
      await db.query("INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES ($1, $2, 1)", [first, itemId]);
      const second = await ret();
      expect(
        (await dbError(db, "INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES ($1, $2, 2)", [second, itemId]))
          ?.message,
      ).toMatch(/cannot return 2/);
      expect(
        await dbError(db, "INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES ($1, $2, 1)", [second, itemId]),
      ).toBeNull();
    });
  });

  it("validates coupons", async () => {
    await inTx(async (db) => {
      const ins = "INSERT INTO coupons (code, type, percent_bp, amount) VALUES ($1, $2::coupon_type, $3, $4)";
      expect((await dbError(db, ins, ["test10", "percent", 1000, null]))?.constraint).toBe("coupons_code_format");
      expect((await dbError(db, ins, ["TEST10", "percent", 20000, null]))?.constraint).toBe("coupons_type_values");
      expect((await dbError(db, ins, ["TEST10", "fixed_amount", null, 0]))?.constraint).toBe("coupons_type_values");
      expect(await dbError(db, ins, ["TEST10", "percent", 1000, null])).toBeNull();
      expect((await dbError(db, ins, ["TEST10", "fixed_amount", null, 100000]))?.constraint).toBe("coupons_code_active");
    });
  });

  it("validates addresses", async () => {
    await inTx(async (db) => {
      const { orderId } = await createOrder(db);
      const err = await dbError(
        db,
        `INSERT INTO order_addresses (order_id, type, recipient_name, phone, province, city, address_line, postal_code)
         VALUES ($1, 'shipping', 'TEST', '+989000000000', 'TEST', 'TEST', 'TEST', '12345')`,
        [orderId],
      );
      expect(err?.constraint).toBe("order_addresses_postal_code");
    });
  });

  it("makes issued invoices immutable except e-invoice status", async () => {
    await inTx(async (db) => {
      const { orderId } = await createOrder(db);
      const inv = await one<{ id: string }>(
        db,
        `INSERT INTO invoices (type, order_id, subtotal, discount_total, shipping_total, tax_total, grand_total,
                               seller_snapshot, buyer_snapshot, lines_snapshot)
         VALUES ('sale', $1, 1000000, 100000, 50000, 0, 950000, '{}', '{}', '[]') RETURNING id`,
        [orderId],
      );
      expect((await dbError(db, "UPDATE invoices SET grand_total = 1, subtotal = 51000 WHERE id = $1", [inv.id]))?.message).toMatch(
        /immutable/,
      );
      expect(await dbError(db, "UPDATE invoices SET einvoice_status = 'pending' WHERE id = $1", [inv.id])).toBeNull();
      expect((await dbError(db, "DELETE FROM invoices WHERE id = $1", [inv.id]))?.message).toMatch(/credit note/);
      expect(
        (await dbError(
          db,
          `INSERT INTO invoices (type, order_id, subtotal, discount_total, shipping_total, tax_total, grand_total,
                                 seller_snapshot, buyer_snapshot, lines_snapshot)
           VALUES ('sale', $1, 0, 0, 0, 0, 0, '{}', '{}', '[]')`,
          [orderId],
        ))?.constraint,
      ).toBe("invoices_single_sale_per_order");
    });
  });
});

describe("payment transactions", () => {
  const insertPayment = `INSERT INTO payment_transactions (order_id, provider_id, amount, our_reference, idempotency_key)
                         VALUES ($1, $2, $3, $4, $5) RETURNING id`;

  it("allows one successful payment per order and unique gateway references", async () => {
    await inTx(async (db) => {
      const { orderId } = await createOrder(db);
      const prov = await provider(db);
      const a = await one<{ id: string }>(db, insertPayment, [orderId, prov, 950000, "TEST-A", "k-a"]);
      const b = await one<{ id: string }>(db, insertPayment, [orderId, prov, 950000, "TEST-B", "k-b"]);
      const succeed = (id: string, ref: string) =>
        dbError(db, "UPDATE payment_transactions SET status = 'succeeded', verified_at = now(), provider_reference = $2 WHERE id = $1", [
          id,
          ref,
        ]);
      expect(await succeed(a.id, "REF-1")).toBeNull();
      expect((await succeed(b.id, "REF-2"))?.constraint).toBe("payment_transactions_single_success");
      expect((await succeed(b.id, "REF-1"))?.constraint).toBe("payment_transactions_provider_reference_key");
      expect((await dbError(db, insertPayment, [orderId, prov, 950000, "TEST-A", "k-c"]))?.constraint).toBe(
        "payment_transactions_our_reference_key",
      );
    });
  });

  it("requires verification data on success and keeps final rows immutable", async () => {
    await inTx(async (db) => {
      const { orderId } = await createOrder(db);
      const prov = await provider(db);
      const t = await one<{ id: string }>(db, insertPayment, [orderId, prov, 950000, "TEST-C", "k-c"]);
      expect((await dbError(db, "UPDATE payment_transactions SET status = 'succeeded' WHERE id = $1", [t.id]))?.constraint).toBe(
        "payment_transactions_succeeded_verified",
      );
      expect((await dbError(db, "UPDATE payment_transactions SET amount = 1 WHERE id = $1", [t.id]))?.message).toMatch(
        /immutable/,
      );
      await db.query(
        "UPDATE payment_transactions SET status = 'succeeded', verified_at = now(), provider_reference = 'REF-C' WHERE id = $1",
        [t.id],
      );
      expect((await dbError(db, "UPDATE payment_transactions SET status = 'failed' WHERE id = $1", [t.id]))?.message).toMatch(
        /is final/,
      );
      expect((await dbError(db, "UPDATE payment_transactions SET masked_card = '6037****1234' WHERE id = $1", [t.id]))?.message).toMatch(
        /is final/,
      );
      expect((await dbError(db, "DELETE FROM payment_transactions WHERE id = $1", [t.id]))?.message).toMatch(/cannot be deleted/);
      await db.query("INSERT INTO payment_callback_logs (payment_transaction_id, provider_code, payload) VALUES ($1, 'test', '{}')", [
        t.id,
      ]);
      expect((await dbError(db, "DELETE FROM payment_callback_logs"))?.message).toMatch(/append-only/);
    });
  });
});
