import { describe, expect, it } from "vitest";
import {
  balance,
  createLocation,
  createProduct,
  createUser,
  dbError,
  inTx,
  move,
  one,
  pool,
  setActor,
} from "./helpers";

type Db = Parameters<typeof move>[0];

const RESERVE_SQL = `INSERT INTO stock_reservations (variant_id, location_id, cart_id, quantity, expires_at)
   VALUES ($1, $2, $3, $4, now() + interval '20 minutes') RETURNING id`;

async function guestCart(db: Db): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "INSERT INTO carts (guest_token_hash) VALUES (encode(sha256(gen_random_uuid()::text::bytea), 'hex')) RETURNING id",
    )
  ).id;
}

async function reservation(db: Db, variantId: string, locationId: string, qty: number) {
  return one<{ id: string }>(db, RESERVE_SQL, [variantId, locationId, await guestCart(db), qty]);
}

async function reservationError(db: Db, variantId: string, locationId: string, qty: number) {
  return dbError(db, RESERVE_SQL, [variantId, locationId, await guestCart(db), qty]);
}

describe("inventory ledger", () => {
  it("applies every movement type to on_hand and records the result", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      await setActor(db, user);
      const p = await createProduct(db);
      const loc = await createLocation(db);
      const steps: [string, number, number][] = [
        ["receipt", 10, 10],
        ["issue", 2, 8],
        ["sale", 1, 7],
        ["return", 1, 8],
        ["adjustment_minus", 3, 5],
        ["adjustment_plus", 1, 6],
        ["count_loss", 1, 5],
        ["count_gain", 2, 7],
      ];
      for (const [type, qty, expected] of steps) {
        await move(db, p.variantId, loc, type, qty);
        expect((await balance(db, p.variantId, loc.locationId)).on_hand).toBe(expected);
      }
      const ledger = await db.query<{ type: string; on_hand_after: number; actor_user_id: string }>(
        "SELECT type, on_hand_after, actor_user_id FROM inventory_movements WHERE variant_id = $1 ORDER BY occurred_at, id",
        [p.variantId],
      );
      expect(ledger.rows.map((r) => r.on_hand_after)).toEqual(steps.map((s) => s[2]));
      expect(new Set(ledger.rows.map((r) => r.actor_user_id))).toEqual(new Set([user]));
    });
  });

  it("never lets stock go negative", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      await move(db, p.variantId, loc, "receipt", 2);
      const err = await dbError(
        db,
        `INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type)
         VALUES ($1, $2, $3, 'issue', 3, 'manual')`,
        [p.variantId, loc.locationId, loc.warehouseId],
      );
      expect(err?.constraint).toBe("inventory_balances_on_hand_non_negative");
      expect((await balance(db, p.variantId, loc.locationId)).on_hand).toBe(2);
      expect((await db.query("SELECT 1 FROM inventory_movements WHERE variant_id = $1", [p.variantId])).rowCount).toBe(1);
    });
  });

  it("rejects direct balance writes and ledger edits", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      await move(db, p.variantId, loc, "receipt", 5);
      expect((await dbError(db, "UPDATE inventory_balances SET on_hand = 100 WHERE variant_id = $1", [p.variantId]))?.message).toMatch(
        /only through inventory_movements/,
      );
      expect((await dbError(db, "DELETE FROM inventory_balances WHERE variant_id = $1", [p.variantId]))?.message).toMatch(
        /cannot be deleted/,
      );
      const other = await createProduct(db);
      expect(
        (await dbError(
          db,
          "INSERT INTO inventory_balances (variant_id, location_id, warehouse_id, on_hand) VALUES ($1, $2, $3, 50)",
          [other.variantId, loc.locationId, loc.warehouseId],
        ))?.message,
      ).toMatch(/start at zero/);
      expect((await dbError(db, "UPDATE inventory_movements SET quantity = 50"))?.message).toMatch(/append-only/);
      expect((await dbError(db, "DELETE FROM inventory_movements"))?.message).toMatch(/append-only/);
    });
  });

  it("rejects a location that is not in the given warehouse", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const a = await createLocation(db);
      const b = await createLocation(db);
      const err = await dbError(
        db,
        `INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type)
         VALUES ($1, $2, $3, 'receipt', 1, 'manual')`,
        [p.variantId, a.locationId, b.warehouseId],
      );
      expect(err?.message).toMatch(/is not in warehouse/);
    });
  });

  it("moves stock between warehouses with two linked movements", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      const p = await createProduct(db);
      const from = await createLocation(db);
      const to = await createLocation(db);
      await move(db, p.variantId, from, "receipt", 5);
      const transfer = await one<{ id: string }>(
        db,
        "INSERT INTO stock_transfers (from_warehouse_id, to_warehouse_id, created_by) VALUES ($1, $2, $3) RETURNING id",
        [from.warehouseId, to.warehouseId, user],
      );
      await move(db, p.variantId, from, "transfer_out", 3, { transferId: transfer.id });
      await move(db, p.variantId, to, "transfer_in", 3, { transferId: transfer.id });
      expect((await balance(db, p.variantId, from.locationId)).on_hand).toBe(2);
      expect((await balance(db, p.variantId, to.locationId)).on_hand).toBe(3);
      // A transfer movement must name its transfer.
      expect(
        (await dbError(
          db,
          `INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type)
           VALUES ($1, $2, $3, 'transfer_out', 1, 'transfer')`,
          [p.variantId, from.locationId, from.warehouseId],
        ))?.constraint,
      ).toBe("inventory_movements_transfer_link");
      expect(
        (await dbError(db, "INSERT INTO stock_transfers (from_warehouse_id, to_warehouse_id, created_by) VALUES ($1, $1, $2)", [
          from.warehouseId,
          user,
        ]))?.constraint,
      ).toBe("stock_transfers_distinct_warehouses");
    });
  });
});

describe("stock reservations", () => {
  it("reserves available stock and refuses to over-reserve", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      await move(db, p.variantId, loc, "receipt", 5);
      await reservation(db, p.variantId, loc.locationId, 3);
      expect(await balance(db, p.variantId, loc.locationId)).toEqual({ on_hand: 5, reserved: 3 });
      const err = await reservationError(db, p.variantId, loc.locationId, 3);
      expect(err?.constraint).toBe("inventory_balances_reserved_le_on_hand");
      // Reserved stock cannot be issued either.
      expect(
        (await dbError(
          db,
          `INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type)
           VALUES ($1, $2, $3, 'issue', 3, 'manual')`,
          [p.variantId, loc.locationId, loc.warehouseId],
        ))?.constraint,
      ).toBe("inventory_balances_reserved_le_on_hand");
    });
  });

  it("fails when there is no stock record at all", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      const err = await reservationError(db, p.variantId, loc.locationId, 1);
      expect(err?.message).toMatch(/no stock/);
    });
  });

  it("releases once, and a released reservation cannot change again", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      await move(db, p.variantId, loc, "receipt", 4);
      const r = await reservation(db, p.variantId, loc.locationId, 4);
      await db.query("UPDATE stock_reservations SET status = 'expired' WHERE id = $1", [r.id]);
      expect(await balance(db, p.variantId, loc.locationId)).toEqual({ on_hand: 4, reserved: 0 });
      expect((await dbError(db, "UPDATE stock_reservations SET status = 'released' WHERE id = $1", [r.id]))?.message).toMatch(
        /already expired/,
      );
      expect(await balance(db, p.variantId, loc.locationId)).toEqual({ on_hand: 4, reserved: 0 });
      expect((await dbError(db, "DELETE FROM stock_reservations WHERE id = $1", [r.id]))?.message).toMatch(/cannot be deleted/);
    });
  });

  it("turns a consumed reservation into a sale", async () => {
    await inTx(async (db) => {
      const p = await createProduct(db);
      const loc = await createLocation(db);
      await move(db, p.variantId, loc, "receipt", 4);
      const r = await reservation(db, p.variantId, loc.locationId, 3);
      await db.query("UPDATE stock_reservations SET status = 'consumed' WHERE id = $1", [r.id]);
      await move(db, p.variantId, loc, "sale", 3);
      expect(await balance(db, p.variantId, loc.locationId)).toEqual({ on_hand: 1, reserved: 0 });
      const row = await one<{ closed_at: Date | null }>(db, "SELECT closed_at FROM stock_reservations WHERE id = $1", [r.id]);
      expect(row.closed_at).not.toBeNull();
    });
  });

  it("never oversells under concurrent checkouts", async () => {
    // Committed fixtures: each reservation runs in its own connection.
    const setup = await pool.connect();
    let variantId = "";
    let locationId = "";
    try {
      await setup.query("BEGIN");
      const p = await createProduct(setup);
      const loc = await createLocation(setup);
      await move(setup, p.variantId, loc, "receipt", 5);
      await setup.query("COMMIT");
      variantId = p.variantId;
      locationId = loc.locationId;
    } finally {
      setup.release();
    }

    const attempts = 12;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, async () => {
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          await db.query(RESERVE_SQL, [variantId, locationId, await guestCart(db), 1]);
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        } finally {
          db.release();
        }
      }),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(5);
    const final = await pool.query("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = $1 AND location_id = $2", [
      variantId,
      locationId,
    ]);
    expect(final.rows[0]).toEqual({ on_hand: 5, reserved: 5 });
  });
});
