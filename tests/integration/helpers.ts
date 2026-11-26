/**
 * Helpers for database integration tests. Every fixture is synthetic and
 * clearly labelled (TEST-...), created inside the test, and normally rolled
 * back with the test's transaction.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set");

export const pool = new pg.Pool({ connectionString: url, max: 20 });
afterAll(async () => {
  await pool.end();
});

export type Db = pg.PoolClient;

/** Runs fn inside a transaction that is always rolled back. */
export async function inTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}

/**
 * Runs a statement inside a savepoint and returns the database error it
 * raised (or null). The surrounding transaction stays usable.
 */
export async function dbError(db: Db, sql: string, params: unknown[] = []): Promise<pg.DatabaseError | null> {
  await db.query("SAVEPOINT attempt");
  try {
    await db.query(sql, params);
    await db.query("RELEASE SAVEPOINT attempt");
    return null;
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT attempt");
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  }
}

/** Fires deferred constraint triggers now (as COMMIT would) and returns their error. */
export async function commitCheck(db: Db): Promise<pg.DatabaseError | null> {
  return dbError(db, "SET CONSTRAINTS ALL IMMEDIATE");
}

export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<T>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Query returned no rows: ${sql}`);
  return row;
}

export const uid = (): string => randomUUID().slice(0, 8).toUpperCase();

export async function setActor(db: Db, userId: string | null): Promise<void> {
  await db.query("SELECT set_config('app.actor_id', $1, true)", [userId ?? ""]);
}

// ---------------------------------------------------------------- identity

export async function createUser(db: Db, opts: { status?: string } = {}): Promise<string> {
  const id = uid().toLowerCase();
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO users (email, status) VALUES ($1, $2::user_status) RETURNING id`,
    [`test-${id}@example.test`, opts.status ?? "active"],
  );
  return row.id;
}

export async function roleId(db: Db, key: string): Promise<string> {
  return (await one<{ id: string }>(db, "SELECT id FROM roles WHERE key = $1", [key])).id;
}

export async function assignRole(db: Db, userId: string, roleKey: string): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) RETURNING id`,
    [userId, await roleId(db, roleKey)],
  );
  return row.id;
}

// ---------------------------------------------------------------- catalog

export interface ProductFixture {
  productId: string;
  variantId: string;
}

export async function createProduct(db: Db, opts: { price?: bigint } = {}): Promise<ProductFixture> {
  const code = uid();
  const product = await one<{ id: string }>(db, "INSERT INTO products DEFAULT VALUES RETURNING id");
  await db.query(
    `INSERT INTO product_translations (product_id, locale, title, slug, search_title)
     VALUES ($1, 'fa', $2, $3, $4)`,
    [product.id, `TEST-PRODUCT-${code}`, `test-product-${code.toLowerCase()}`, `test-product-${code.toLowerCase()}`],
  );
  const variant = await one<{ id: string }>(
    db,
    `INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [product.id, `TEST-${code}`, `TEST${code}`, (opts.price ?? 1_000_000n).toString()],
  );
  return { productId: product.id, variantId: variant.id };
}

export async function createCategory(db: Db, parentId: string | null = null): Promise<string> {
  return (await one<{ id: string }>(db, "INSERT INTO categories (parent_id) VALUES ($1) RETURNING id", [parentId])).id;
}

// ---------------------------------------------------------------- vehicles

export interface GenerationFixture {
  modelId: string;
  generationId: string;
}

export async function createGeneration(db: Db, yearFrom: number, yearTo: number | null): Promise<GenerationFixture> {
  const m = await one<{ id: string }>(db, "INSERT INTO motorcycle_manufacturers DEFAULT VALUES RETURNING id");
  const b = await one<{ id: string }>(db, "INSERT INTO motorcycle_brands (manufacturer_id) VALUES ($1) RETURNING id", [m.id]);
  const model = await one<{ id: string }>(db, "INSERT INTO motorcycle_models (brand_id) VALUES ($1) RETURNING id", [b.id]);
  const g = await one<{ id: string }>(
    db,
    "INSERT INTO motorcycle_generations (model_id, year_from, year_to) VALUES ($1, $2, $3) RETURNING id",
    [model.id, yearFrom, yearTo],
  );
  return { modelId: model.id, generationId: g.id };
}

export async function createMotorcycleVariant(db: Db, generationId: string): Promise<string> {
  return (
    await one<{ id: string }>(db, "INSERT INTO motorcycle_variants (generation_id) VALUES ($1) RETURNING id", [generationId])
  ).id;
}

export async function createSource(db: Db): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "INSERT INTO compatibility_sources (type, title) VALUES ('supplier_sheet', 'TEST-SOURCE') RETURNING id",
    )
  ).id;
}

// ---------------------------------------------------------------- inventory

export interface LocationFixture {
  warehouseId: string;
  locationId: string;
}

export async function createLocation(db: Db): Promise<LocationFixture> {
  const w = await one<{ id: string }>(
    db,
    "INSERT INTO warehouses (code, name) VALUES ($1, 'TEST-WAREHOUSE') RETURNING id",
    [`TEST-${uid()}`],
  );
  const l = await one<{ id: string }>(
    db,
    "INSERT INTO warehouse_locations (warehouse_id, code, is_default) VALUES ($1, 'MAIN', true) RETURNING id",
    [w.id],
  );
  return { warehouseId: w.id, locationId: l.id };
}

export async function move(
  db: Db,
  variantId: string,
  loc: LocationFixture,
  type: string,
  quantity: number,
  extra: { transferId?: string } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type, transfer_id)
     VALUES ($1, $2, $3, $4::movement_type, $5, $6::movement_reference_type, $7)`,
    [variantId, loc.locationId, loc.warehouseId, type, quantity, extra.transferId ? "transfer" : "manual", extra.transferId ?? null],
  );
}

export async function balance(db: Db, variantId: string, locationId: string): Promise<{ on_hand: number; reserved: number }> {
  return one(db, "SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = $1 AND location_id = $2", [
    variantId,
    locationId,
  ]);
}

// ---------------------------------------------------------------- sales

export interface OrderFixture {
  orderId: string;
  itemId: string;
  product: ProductFixture;
}

/** A pending order with one line: unit 500,000 x 2, line discount 100,000, shipping 50,000. */
export async function createOrder(db: Db): Promise<OrderFixture> {
  const product = await createProduct(db, { price: 500_000n });
  const order = await one<{ id: string }>(
    db,
    `INSERT INTO orders (subtotal, discount_total, shipping_total, tax_total, grand_total, customer_name, customer_phone)
     VALUES (1000000, 100000, 50000, 0, 950000, 'TEST CUSTOMER', '+989000000000') RETURNING id`,
  );
  const item = await one<{ id: string }>(
    db,
    `INSERT INTO order_items (order_id, product_id, variant_id, sku, title_fa, snapshot, quantity, unit_price, discount_total, line_total)
     VALUES ($1, $2, $3, 'TEST-SKU', 'TEST-ITEM', '{}', 2, 500000, 100000, 900000) RETURNING id`,
    [order.id, product.productId, product.variantId],
  );
  return { orderId: order.id, itemId: item.id, product };
}

// ---------------------------------------------------------------- accounting

export async function createPeriod(db: Db, start: string, end: string, status = "open"): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO financial_periods (name, start_date, end_date, status, closed_at)
       VALUES ($1, $2, $3, $4::period_status, CASE WHEN $4 = 'closed' THEN now() END) RETURNING id`,
      [`TEST-${uid()}`, start, end, status],
    )
  ).id;
}

export async function createAccount(
  db: Db,
  type: string,
  opts: { parentId?: string; isPostable?: boolean } = {},
): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO financial_accounts (code, name, type, parent_id, is_postable)
       VALUES ($1, 'TEST-ACCOUNT', $2::account_type, $3, $4) RETURNING id`,
      [`T${uid()}`, type, opts.parentId ?? null, opts.isPostable ?? true],
    )
  ).id;
}

export async function createJournal(
  db: Db,
  periodId: string,
  date: string,
  lines: { accountId: string; debit: number; credit: number }[],
  extra: { sourceType?: string; sourceId?: string; sourceEvent?: string; reversesId?: string } = {},
): Promise<string> {
  const t = await one<{ id: string }>(
    db,
    `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type, source_id, source_event, reverses_id)
     VALUES ($1, $2, 'TEST', $3::journal_source_type, $4, $5, $6) RETURNING id`,
    [date, periodId, extra.sourceType ?? "manual", extra.sourceId ?? null, extra.sourceEvent ?? null, extra.reversesId ?? null],
  );
  let lineNo = 1;
  for (const line of lines) {
    await db.query(
      `INSERT INTO accounting_entries (transaction_id, line_no, account_id, debit, credit) VALUES ($1, $2, $3, $4, $5)`,
      [t.id, lineNo++, line.accountId, line.debit, line.credit],
    );
  }
  return t.id;
}

/** Records a verified, succeeded gateway payment for amount (Rial). */
export async function succeededPayment(db: Db, orderId: string, amount: number | bigint): Promise<string> {
  const code = `test_${uid().toLowerCase()}`;
  const prov = await one<{ id: string }>(
    db,
    "INSERT INTO payment_providers (code, adapter_key) VALUES ($1, 'test') RETURNING id",
    [code],
  );
  const ref = `TEST-${uid()}`;
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO payment_transactions (order_id, provider_id, amount, our_reference, idempotency_key,
                                         status, verified_at, provider_reference)
       VALUES ($1, $2, $3, $4, $4, 'succeeded', now(), $4) RETURNING id`,
      [orderId, prov.id, amount.toString(), ref],
    )
  ).id;
}

/** Pays a fixture order (grand total 950,000) and marks it paid. */
export async function payOrder(db: Db, orderId: string): Promise<void> {
  await succeededPayment(db, orderId, 950_000);
  await db.query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);
}
