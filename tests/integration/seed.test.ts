import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { BUSINESS_TABLES } from "./business-tables";
import { seedSystemData } from "../../prisma/seed/system-seed";
import { defaultGrants, PERMISSIONS, SYSTEM_ROLES } from "@/modules/rbac/domain/permission-catalogue";
import { STORE_SETTINGS, SYSTEM_SETTINGS } from "@/modules/settings/domain/default-settings";
import { inTx, pool } from "./helpers";

describe("system seed", () => {
  it("creates no business data", () => {
    // Counted by global setup right after migrations + seed, before any test
    // (some tests commit synthetic fixtures).
    const counts = inject("businessRowCountsAfterSeed");
    expect(Object.keys(counts)).toEqual([...BUSINESS_TABLES]);
    expect(Object.entries(counts).filter(([, n]) => n !== 0)).toEqual([]);
  });

  it("creates the fa/en locales and the IRR currency only", async () => {
    const locales = await pool.query("SELECT code, direction, is_default FROM locales ORDER BY sort_order");
    expect(locales.rows).toEqual([
      { code: "fa", direction: "rtl", is_default: true },
      { code: "en", direction: "ltr", is_default: false },
    ]);
    const currencies = await pool.query("SELECT code, decimal_places, is_default FROM currencies");
    expect(currencies.rows).toEqual([{ code: "IRR", decimal_places: 0, is_default: true }]);
  });

  it("syncs every catalogue permission with its level ceiling and MFA flag", async () => {
    const { rows } = await pool.query<{ key: string; max_level: number; requires_mfa: boolean; scope_type: string | null }>(
      "SELECT key, max_level, requires_mfa, scope_type FROM permissions WHERE is_active",
    );
    expect(rows).toHaveLength(PERMISSIONS.length);
    for (const perm of PERMISSIONS) {
      expect(rows.find((r) => r.key === perm.key)).toEqual({
        key: perm.key,
        max_level: perm.maxLevel,
        requires_mfa: perm.requiresMfa,
        scope_type: perm.scope,
      });
    }
  });

  it("creates the four system roles with their default bundles", async () => {
    for (const role of SYSTEM_ROLES) {
      const { rows } = await pool.query<{ key: string; is_scoped: boolean }>(
        `SELECT p.key, rp.is_scoped FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
         WHERE r.key = $1 ORDER BY p.key`,
        [role.key],
      );
      const expected = defaultGrants(role)
        .map((g) => ({ key: g.key, is_scoped: g.isScoped }))
        .sort((a, b) => a.key.localeCompare(b.key));
      expect(rows).toEqual(expected);
    }
    // Other suites commit synthetic custom roles; this checks the system ones.
    const roles = await pool.query("SELECT key, level, is_system FROM roles WHERE is_system ORDER BY level");
    expect(roles.rows).toEqual([
      { key: "customer", level: 0, is_system: true },
      { key: "super_admin", level: 1, is_system: true },
      { key: "business_admin", level: 2, is_system: true },
      { key: "store_staff", level: 3, is_system: true },
    ]);
  });

  it("gives Store Staff no financial, payment, settings, role or permanent-delete permission", async () => {
    const { rows } = await pool.query<{ key: string }>(
      `SELECT p.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id WHERE r.key = 'store_staff'`,
    );
    const keys = rows.map((r) => r.key);
    const forbidden = /^(accounting|expense|income|report|payment_provider|settings|role|user|refund|price\.update$|inventory\.view_cost|order\.view_payment|product\.delete_permanent|backup|deployment|audit|monitoring|integration|pagebuilder|theme)/;
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
  });

  it("gives Business Admin no Super Admin-only permission", async () => {
    const { rows } = await pool.query<{ key: string }>(
      `SELECT p.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id WHERE r.key = 'business_admin' AND p.max_level = 1`,
    );
    expect(rows).toEqual([]);
  });

  it("inserts every required setting", async () => {
    const store = await pool.query<{ key: string }>("SELECT key FROM store_settings");
    const system = await pool.query<{ key: string }>("SELECT key FROM system_settings");
    expect(store.rows.map((r) => r.key).sort()).toEqual(STORE_SETTINGS.map((s) => s.key).sort());
    expect(system.rows.map((r) => r.key).sort()).toEqual(SYSTEM_SETTINGS.map((s) => s.key).sort());
  });

  it("is idempotent and keeps changes made by admins", async () => {
    await inTx(async (db) => {
      // An admin removed a default grant and changed a setting.
      await db.query(
        `DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE key = 'store_staff')
           AND permission_id = (SELECT id FROM permissions WHERE key = 'article.manage')`,
      );
      await db.query(`UPDATE store_settings SET value = '"rial"' WHERE key = 'store.display_currency_unit'`);
      // seedSystemData manages its own transaction; run it on a savepoint-free nested client.
      await db.query("SAVEPOINT seed");
      const report = await seedWithin(db);
      expect(report).toEqual({
        permissionsCreated: 0,
        permissionsDeactivated: 0,
        rolesCreated: 0,
        grantsAdded: 0,
        settingsCreated: 0,
      });
      const grant = await db.query(
        `SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
         WHERE r.key = 'store_staff' AND p.key = 'article.manage'`,
      );
      expect(grant.rowCount).toBe(0);
      const setting = await db.query(`SELECT value FROM store_settings WHERE key = 'store.display_currency_unit'`);
      expect(setting.rows[0]).toEqual({ value: "rial" });
    });
  });
});

/**
 * seedSystemData issues BEGIN/COMMIT itself. Inside an outer test transaction
 * PostgreSQL only warns on BEGIN, and we intercept COMMIT/ROLLBACK so the
 * outer transaction (and its rollback) stays in control.
 */
async function seedWithin(db: pg.PoolClient) {
  const proxy = {
    query: (text: string, params?: unknown[]) => {
      if (text === "BEGIN" || text === "COMMIT") return Promise.resolve({ rows: [], rowCount: 0 });
      if (text === "ROLLBACK") return db.query("ROLLBACK TO SAVEPOINT seed");
      return db.query(text, params);
    },
  } as unknown as pg.ClientBase;
  return seedSystemData(proxy);
}
