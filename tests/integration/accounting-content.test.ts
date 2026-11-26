import { describe, expect, it } from "vitest";
import {
  commitCheck,
  createAccount,
  createJournal,
  createPeriod,
  createUser,
  dbError,
  inTx,
  one,
  pool,
  setActor,
  uid,
} from "./helpers";

const post = (id: string) => `UPDATE accounting_transactions SET status = 'posted' WHERE id = '${id}'`;

describe("double-entry accounting", () => {
  it("posts a balanced transaction and records who posted it", async () => {
    await inTx(async (db) => {
      const accountant = await createUser(db);
      await setActor(db, accountant);
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const cash = await createAccount(db, "asset");
      const sales = await createAccount(db, "income");
      const t = await createJournal(db, period, "2026-06-01", [
        { accountId: cash, debit: 950000, credit: 0 },
        { accountId: sales, debit: 0, credit: 950000 },
      ]);
      await db.query(post(t));
      expect(await commitCheck(db)).toBeNull();
      const row = await one(db, "SELECT posted_by, posted_at IS NOT NULL AS has_posted_at FROM accounting_transactions WHERE id = $1", [t]);
      expect(row).toEqual({ posted_by: accountant, has_posted_at: true });
    });
  });

  it("refuses to post an unbalanced or one-line transaction", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const cash = await createAccount(db, "asset");
      const sales = await createAccount(db, "income");
      const t = await createJournal(db, period, "2026-06-01", [
        { accountId: cash, debit: 950000, credit: 0 },
        { accountId: sales, debit: 0, credit: 900000 },
      ]);
      await db.query(post(t));
      expect((await commitCheck(db))?.message).toMatch(/does not balance/);
    });
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const cash = await createAccount(db, "asset");
      const t = await createJournal(db, period, "2026-06-01", [{ accountId: cash, debit: 1, credit: 0 }]);
      await db.query(post(t));
      expect((await commitCheck(db))?.message).toMatch(/does not balance/);
    });
  });

  it("rejects lines with both or neither of debit and credit", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const cash = await createAccount(db, "asset");
      const t = await createJournal(db, period, "2026-06-01", []);
      const ins = "INSERT INTO accounting_entries (transaction_id, line_no, account_id, debit, credit) VALUES ($1, 1, $2, $3, $4)";
      expect((await dbError(db, ins, [t, cash, 5, 5]))?.constraint).toBe("accounting_entries_one_side");
      expect((await dbError(db, ins, [t, cash, 0, 0]))?.constraint).toBe("accounting_entries_one_side");
      expect((await dbError(db, ins, [t, cash, -5, 0]))?.constraint).toBe("accounting_entries_amounts_non_negative");
    });
  });

  it("makes posted transactions and their entries immutable; corrections are reversals", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const cash = await createAccount(db, "asset");
      const sales = await createAccount(db, "income");
      const lines = [
        { accountId: cash, debit: 500, credit: 0 },
        { accountId: sales, debit: 0, credit: 500 },
      ];
      const t = await createJournal(db, period, "2026-06-01", lines);
      await db.query(post(t));
      expect((await dbError(db, "UPDATE accounting_transactions SET description = 'x' WHERE id = $1", [t]))?.message).toMatch(
        /immutable/,
      );
      expect((await dbError(db, "DELETE FROM accounting_transactions WHERE id = $1", [t]))?.message).toMatch(/cannot be deleted/);
      expect((await dbError(db, "UPDATE accounting_entries SET debit = 600 WHERE transaction_id = $1 AND debit > 0", [t]))?.message).toMatch(
        /immutable/,
      );
      expect(
        (await dbError(db, "INSERT INTO accounting_entries (transaction_id, line_no, account_id, debit) VALUES ($1, 9, $2, 1)", [t, cash]))
          ?.message,
      ).toMatch(/immutable/);

      const reversal = await createJournal(
        db,
        period,
        "2026-06-02",
        lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
        { sourceType: "reversal", reversesId: t },
      );
      await db.query(post(reversal));
      expect(await commitCheck(db)).toBeNull();
      const net = await db.query<{ account_id: string; net: string }>(
        `SELECT account_id, sum(debit - credit)::text AS net FROM accounting_entries
         WHERE transaction_id = ANY($1) GROUP BY account_id`,
        [[t, reversal]],
      );
      expect(net.rows.every((r) => r.net === "0")).toBe(true);
      // A transaction can be reversed only once.
      const again = await dbError(
        db,
        `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type, reverses_id)
         VALUES ('2026-06-03', $1, 'TEST', 'reversal', $2)`,
        [period, t],
      );
      expect(again?.constraint).toBe("accounting_transactions_reverses_id_key");
    });
  });

  it("does not let a concurrent transaction add entries to a journal being posted", async () => {
    // Committed fixtures in a far-future period no other test uses.
    const setup = await pool.connect();
    let txId = "";
    let accountId = "";
    try {
      await setup.query("BEGIN");
      const period = await createPeriod(setup, "2099-01-01", "2099-01-31");
      const cash = await createAccount(setup, "asset");
      const income = await createAccount(setup, "income");
      txId = await createJournal(setup, period, "2099-01-15", [
        { accountId: cash, debit: 1000, credit: 0 },
        { accountId: income, debit: 0, credit: 1000 },
      ]);
      await setup.query("COMMIT");
      accountId = cash;
    } finally {
      setup.release();
    }

    const poster = await pool.connect();
    const writer = await pool.connect();
    try {
      await poster.query("BEGIN");
      await poster.query(post(txId));
      await writer.query("BEGIN");
      let settled = false;
      const insert = writer
        .query("INSERT INTO accounting_entries (transaction_id, line_no, account_id, debit, credit) VALUES ($1, 9, $2, 500, 0)", [
          txId,
          accountId,
        ])
        .then(
          () => null,
          (error: Error) => error,
        )
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // blocked by the posting transaction
      await poster.query("COMMIT");
      expect((await insert)?.message).toMatch(/posted transaction .* immutable/);
      await writer.query("ROLLBACK");
    } finally {
      poster.release();
      writer.release();
    }
    const totals = await pool.query("SELECT count(*)::int AS n, sum(debit)::int AS d FROM accounting_entries WHERE transaction_id = $1", [
      txId,
    ]);
    expect(totals.rows[0]).toEqual({ n: 2, d: 1000 });
  });

  it("only reverses posted transactions", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const draft = await createJournal(db, period, "2026-06-01", []);
      const err = await dbError(
        db,
        `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type, reverses_id)
         VALUES ('2026-06-01', $1, 'TEST', 'reversal', $2)`,
        [period, draft],
      );
      expect(err?.message).toMatch(/only posted transactions can be reversed/);
    });
  });

  it("requires transactions to be inserted as drafts", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const err = await dbError(
        db,
        `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type, status, posted_at)
         VALUES ('2026-06-01', $1, 'TEST', 'manual', 'posted', now())`,
        [period],
      );
      expect(err?.message).toMatch(/insert transactions as draft/);
    });
  });

  it("rejects postings into closed periods and dates outside the period", async () => {
    await inTx(async (db) => {
      const closed = await createPeriod(db, "2025-01-01", "2025-12-31", "closed");
      const open = await createPeriod(db, "2026-01-01", "2026-12-31");
      expect((await dbError(db, `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type) VALUES ('2025-05-01', $1, 'T', 'manual')`, [closed]))?.message).toMatch(
        /is closed/,
      );
      expect((await dbError(db, `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type) VALUES ('2027-01-01', $1, 'T', 'manual')`, [open]))?.message).toMatch(
        /outside period/,
      );
    });
  });

  it("does not allow overlapping periods", async () => {
    await inTx(async (db) => {
      await createPeriod(db, "2026-01-01", "2026-06-30");
      const err = await dbError(
        db,
        "INSERT INTO financial_periods (name, start_date, end_date) VALUES ($1, '2026-06-30', '2026-12-31')",
        [`TEST-${uid()}`],
      );
      expect(err?.constraint).toBe("financial_periods_no_overlap");
    });
  });

  it("posts a business event once (idempotent source key)", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const source = { sourceType: "order_payment", sourceId: "00000000-0000-7000-8000-000000000001", sourceEvent: "order.paid" };
      await createJournal(db, period, "2026-06-01", [], source);
      const err = await dbError(
        db,
        `INSERT INTO accounting_transactions (entry_date, period_id, description, source_type, source_id, source_event)
         VALUES ('2026-06-01', $1, 'TEST', 'order_payment', $2, 'order.paid')`,
        [period, source.sourceId],
      );
      expect(err?.constraint).toBe("accounting_transactions_source_key");
    });
  });

  it("posts only to active, postable accounts and keeps the account tree consistent", async () => {
    await inTx(async (db) => {
      const period = await createPeriod(db, "2026-01-01", "2026-12-31");
      const group = await createAccount(db, "asset", { isPostable: false });
      const t = await createJournal(db, period, "2026-06-01", []);
      expect(
        (await dbError(db, "INSERT INTO accounting_entries (transaction_id, line_no, account_id, debit) VALUES ($1, 1, $2, 1)", [t, group]))
          ?.message,
      ).toMatch(/not postable/);
      expect((await dbError(db, "INSERT INTO financial_accounts (code, name, type, parent_id) VALUES ('TX1', 'T', 'income', $1)", [group]))?.message).toMatch(
        /same type as its parent/,
      );
      const child = await createAccount(db, "asset", { parentId: group });
      expect((await dbError(db, "UPDATE financial_accounts SET parent_id = $1 WHERE id = $2", [child, group]))?.message).toMatch(
        /own ancestor/,
      );
      expect((await dbError(db, "DELETE FROM financial_accounts WHERE id = $1", [child]))?.message).toMatch(/cannot be deleted/);
    });
  });
});

describe("content and page builder", () => {
  it("keeps revision content immutable and published revisions undeletable", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      const page = await one<{ id: string }>(db, "INSERT INTO pages (key) VALUES ('test_home') RETURNING id");
      const rev = await one<{ id: string }>(
        db,
        `INSERT INTO page_revisions (page_id, revision_no, schema_version, document, created_by)
         VALUES ($1, 1, 1, '{"version": 1, "sections": []}', $2) RETURNING id`,
        [page.id, user],
      );
      expect((await dbError(db, `UPDATE page_revisions SET document = '{"version": 1, "sections": [{}]}' WHERE id = $1`, [rev.id]))?.message).toMatch(
        /immutable/,
      );
      await db.query("UPDATE page_revisions SET status = 'published', published_by = $2, published_at = now() WHERE id = $1", [
        rev.id,
        user,
      ]);
      await db.query("UPDATE pages SET published_revision_id = $2, status = 'published' WHERE id = $1", [page.id, rev.id]);
      expect((await dbError(db, "DELETE FROM page_revisions WHERE id = $1", [rev.id]))?.message).toMatch(/kept for rollback/);

      const other = await one<{ id: string }>(db, "INSERT INTO pages (key) VALUES ('test_other') RETURNING id");
      expect((await dbError(db, "UPDATE pages SET published_revision_id = $2 WHERE id = $1", [other.id, rev.id]))?.message).toMatch(
        /does not belong/,
      );
    });
  });

  it("accepts only allow-listed media types and safe banner links", async () => {
    await inTx(async (db) => {
      const media = (mime: string) =>
        dbError(
          db,
          `INSERT INTO media_library (storage_key, bucket, kind, original_filename, mime_type, size_bytes, sha256)
           VALUES ($1, 'test', 'image', 'x', $2, 10, repeat('a', 64)) RETURNING id`,
          [`test/${uid()}`, mime],
        );
      expect((await media("image/svg+xml"))?.constraint).toBe("media_library_kind_mime");
      expect((await media("text/html"))?.constraint).toBe("media_library_kind_mime");
      expect(await media("image/webp")).toBeNull();
      const img = await one<{ id: string }>(db, "SELECT id FROM media_library ORDER BY created_at DESC LIMIT 1");
      const banner = (href: string) =>
        dbError(db, "INSERT INTO banners (placement, desktop_media_id, href) VALUES ('home_hero', $1, $2)", [img.id, href]);
      expect((await banner("javascript:alert(1)"))?.constraint).toBe("banners_href_safe");
      expect((await banner("//evil.example"))?.constraint).toBe("banners_href_safe");
      expect((await banner("http://insecure.example"))?.constraint).toBe("banners_href_safe");
      expect((await banner("/\\evil.example"))?.constraint).toBe("banners_href_safe");
      expect((await banner("/fa/x\nLocation: y"))?.constraint).toBe("banners_href_safe");
      expect(await banner("/fa/categories/brakes")).toBeNull();
    });
  });

  it("requires a Persian alt text on product images", async () => {
    await inTx(async (db) => {
      const err = await dbError(
        db,
        `INSERT INTO product_images (product_id, media_id, alt) VALUES (gen_uuid_v7(), gen_uuid_v7(), '{"en": "only english"}')`,
      );
      expect(err?.constraint).toBe("product_images_alt_has_fa");
    });
  });

  it("generates time-ordered UUIDv7 keys", async () => {
    const { rows } = await inTx((db) =>
      db.query<{ id: string }>("SELECT gen_uuid_v7()::text AS id FROM generate_series(1, 5)"),
    );
    for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
