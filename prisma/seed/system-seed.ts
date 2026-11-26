/**
 * Idempotent system seed: locales, the IRR currency, the permission catalogue,
 * the four system roles with their default permission bundles, and required
 * settings. It never creates business data (products, categories, brands,
 * motorcycles, fitment, stock, customers, orders, accounts).
 *
 * Safe to run on every deploy:
 * - permissions are upserted from the catalogue; keys removed from the
 *   catalogue are deactivated, not deleted;
 * - system roles are created if missing; a default grant is added only when
 *   the role or the permission is new, so permissions an admin removed from a
 *   role are not re-added;
 * - settings are inserted only when the key is missing.
 *
 * Uses node-postgres directly so it runs under plain Node (type stripping)
 * without the generated Prisma client.
 */
import type { ClientBase } from "pg";
import { defaultGrants, PERMISSIONS, SYSTEM_ROLES } from "../../src/modules/rbac/domain/permission-catalogue.ts";
import { STORE_SETTINGS, SYSTEM_SETTINGS, type SettingDefinition } from "../../src/modules/settings/domain/default-settings.ts";

export interface SeedReport {
  permissionsCreated: number;
  permissionsDeactivated: number;
  rolesCreated: number;
  grantsAdded: number;
  settingsCreated: number;
}

const LOCALES = [
  { code: "fa", name: "Persian", nativeName: "فارسی", direction: "rtl", isDefault: true, sortOrder: 0 },
  { code: "en", name: "English", nativeName: "English", direction: "ltr", isDefault: false, sortOrder: 1 },
] as const;

export async function seedSystemData(db: ClientBase): Promise<SeedReport> {
  const report: SeedReport = {
    permissionsCreated: 0,
    permissionsDeactivated: 0,
    rolesCreated: 0,
    grantsAdded: 0,
    settingsCreated: 0,
  };

  await db.query("BEGIN");
  try {
    // Serialize concurrent seed runs (e.g. two migrate containers).
    await db.query("SELECT pg_advisory_xact_lock(hashtext('clicksp.system_seed'))");

    for (const l of LOCALES) {
      await db.query(
        `INSERT INTO locales (code, name, native_name, direction, is_default, sort_order)
         VALUES ($1, $2, $3, $4::text_direction, $5, $6)
         ON CONFLICT (code) DO NOTHING`,
        [l.code, l.name, l.nativeName, l.direction, l.isDefault, l.sortOrder],
      );
    }

    await db.query(
      `INSERT INTO currencies (code, numeric_code, decimal_places, is_default)
       VALUES ('IRR', '364', 0, true)
       ON CONFLICT (code) DO NOTHING`,
    );

    const newPermissionKeys = new Set<string>();
    for (const perm of PERMISSIONS) {
      const result = await db.query<{ inserted: boolean }>(
        `INSERT INTO permissions (key, module, scope_type, requires_mfa, max_level, is_active)
         VALUES ($1, $2, $3::scope_type, $4, $5, true)
         ON CONFLICT (key) DO UPDATE
           SET module = EXCLUDED.module, scope_type = EXCLUDED.scope_type,
               requires_mfa = EXCLUDED.requires_mfa, max_level = EXCLUDED.max_level, is_active = true
         RETURNING (xmax = 0) AS inserted`,
        [perm.key, perm.module, perm.scope, perm.requiresMfa, perm.maxLevel],
      );
      if (result.rows[0]?.inserted) {
        newPermissionKeys.add(perm.key);
        report.permissionsCreated += 1;
      }
    }
    const deactivated = await db.query(
      `UPDATE permissions SET is_active = false WHERE is_active AND NOT (key = ANY($1::text[]))`,
      [PERMISSIONS.map((perm) => perm.key)],
    );
    report.permissionsDeactivated = deactivated.rowCount ?? 0;

    for (const role of SYSTEM_ROLES) {
      const result = await db.query<{ id: string; inserted: boolean }>(
        `INSERT INTO roles (key, name, level, is_system)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (key) DO UPDATE SET is_system = true
         RETURNING id, (xmax = 0) AS inserted`,
        [role.key, role.name, role.level],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Could not upsert role ${role.key}`);
      if (row.inserted) report.rolesCreated += 1;

      for (const grant of defaultGrants(role)) {
        if (!row.inserted && !newPermissionKeys.has(grant.key)) continue;
        const added = await db.query(
          `INSERT INTO role_permissions (role_id, permission_id, is_scoped)
           SELECT $1, id, $3 FROM permissions WHERE key = $2
           ON CONFLICT DO NOTHING`,
          [row.id, grant.key, grant.isScoped],
        );
        report.grantsAdded += added.rowCount ?? 0;
      }
    }

    report.settingsCreated += await insertMissingSettings(db, "store_settings", STORE_SETTINGS);
    report.settingsCreated += await insertMissingSettings(db, "system_settings", SYSTEM_SETTINGS);

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  return report;
}

async function insertMissingSettings(
  db: ClientBase,
  table: "store_settings" | "system_settings",
  settings: readonly SettingDefinition[],
): Promise<number> {
  let created = 0;
  for (const s of settings) {
    const result = await db.query(
      `INSERT INTO ${table} (key, value_type, value)
       VALUES ($1, $2::setting_value_type, $3::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [s.key, s.valueType, JSON.stringify(s.value)],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}
