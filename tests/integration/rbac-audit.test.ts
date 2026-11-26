import { describe, expect, it } from "vitest";
import { assignRole, createUser, dbError, inTx, one, roleId, setActor } from "./helpers";

async function permissionId(db: Parameters<typeof roleId>[0], key: string): Promise<string> {
  return (await one<{ id: string }>(db, "SELECT id FROM permissions WHERE key = $1", [key])).id;
}

describe("RBAC escalation guards (database level)", () => {
  it("never lets a Business Admin or Staff role hold a Super Admin-only permission", async () => {
    await inTx(async (db) => {
      for (const roleKey of ["business_admin", "store_staff"]) {
        for (const perm of ["role.manage", "settings.system", "deployment.request", "user.manage_admins"]) {
          const err = await dbError(db, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [
            await roleId(db, roleKey),
            await permissionId(db, perm),
          ]);
          expect(err?.message).toMatch(/cannot be granted to a level/);
        }
      }
    });
  });

  it("applies the same ceiling to custom roles", async () => {
    await inTx(async (db) => {
      const custom = await one<{ id: string }>(
        db,
        "INSERT INTO roles (key, name, level) VALUES ('test_manager', 'TEST', 2) RETURNING id",
      );
      const err = await dbError(db, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [
        custom.id,
        await permissionId(db, "role.manage"),
      ]);
      expect(err?.message).toMatch(/cannot be granted/);
      // Allowed: a business permission.
      expect(
        await dbError(db, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [
          custom.id,
          await permissionId(db, "report.sales"),
        ]),
      ).toBeNull();
      // Raising the role above the permission's ceiling is refused.
      await db.query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [
        custom.id,
        await permissionId(db, "user.manage_staff"),
      ]);
      expect((await dbError(db, "UPDATE roles SET level = 3 WHERE id = $1", [custom.id]))?.message).toMatch(
        /holds permissions not allowed/,
      );
    });
  });

  it("gives customer roles (level 0) no permissions", async () => {
    await inTx(async (db) => {
      const err = await dbError(db, "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [
        await roleId(db, "customer"),
        await permissionId(db, "product.view"),
      ]);
      expect(err?.message).toMatch(/level 0/);
    });
  });

  it("refuses scoped grants of permissions that have no scope", async () => {
    await inTx(async (db) => {
      await db.query(
        "DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2",
        [await roleId(db, "business_admin"), await permissionId(db, "report.sales")],
      );
      const err = await dbError(
        db,
        "INSERT INTO role_permissions (role_id, permission_id, is_scoped) VALUES ($1, $2, true)",
        [await roleId(db, "business_admin"), await permissionId(db, "report.sales")],
      );
      expect(err?.message).toMatch(/cannot be granted as scoped/);
    });
  });

  it("protects system roles from deletion and key/level changes", async () => {
    await inTx(async (db) => {
      expect((await dbError(db, "DELETE FROM roles WHERE key = 'store_staff'"))?.message).toMatch(/cannot be deleted/);
      expect((await dbError(db, "UPDATE roles SET level = 1 WHERE key = 'store_staff'"))?.message).toMatch(
        /cannot change key, level/,
      );
      expect((await dbError(db, "UPDATE roles SET key = 'owner' WHERE key = 'super_admin'"))?.message).toMatch(
        /cannot change key, level/,
      );
    });
  });

  it("keeps at least one active Super Admin", async () => {
    await inTx(async (db) => {
      const first = await createUser(db);
      const firstRole = await assignRole(db, first, "super_admin");

      expect((await dbError(db, "UPDATE users SET status = 'disabled' WHERE id = $1", [first]))?.message).toMatch(
        /last active Super Admin/,
      );
      expect((await dbError(db, "DELETE FROM user_roles WHERE id = $1", [firstRole]))?.message).toMatch(
        /last active Super Admin/,
      );
      expect((await dbError(db, "UPDATE roles SET is_active = false WHERE key = 'super_admin'"))?.message).toMatch(
        /last active Super Admin/,
      );

      // With a second Super Admin the first can be disabled.
      const second = await createUser(db);
      await assignRole(db, second, "super_admin");
      expect(await dbError(db, "UPDATE users SET status = 'disabled' WHERE id = $1", [first])).toBeNull();
      // ...but now the second is the last one.
      expect((await dbError(db, "UPDATE users SET status = 'locked' WHERE id = $1", [second]))?.message).toMatch(
        /last active Super Admin/,
      );
      // An expiry date on the last permanent grant would lock everyone out later.
      expect(
        (await dbError(db, "UPDATE user_roles SET expires_at = now() + interval '1 day' WHERE user_id = $1", [second]))?.message,
      ).toMatch(/last active Super Admin/);
    });
  });

  it("does not block ordinary users when no Super Admin exists yet", async () => {
    await inTx(async (db) => {
      const staff = await createUser(db);
      await assignRole(db, staff, "store_staff");
      expect(await dbError(db, "UPDATE users SET status = 'disabled' WHERE id = $1", [staff])).toBeNull();
    });
  });

  it("never deletes users and validates identifiers", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      expect((await dbError(db, "DELETE FROM users WHERE id = $1", [user]))?.message).toMatch(/cannot be deleted/);
      expect((await dbError(db, "INSERT INTO users (email) VALUES ('Mixed@Example.test')"))?.constraint).toBe(
        "users_email_lowercase",
      );
      expect((await dbError(db, "INSERT INTO users (phone_number) VALUES ('09121234567')"))?.constraint).toBe(
        "users_phone_e164",
      );
      expect((await dbError(db, "INSERT INTO users (name) VALUES ('no identifier')"))?.constraint).toBe(
        "users_has_identifier",
      );
    });
  });

  it("stores only hashed session tokens", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      const err = await dbError(
        db,
        "INSERT INTO sessions (user_id, token_hash, kind, expires_at) VALUES ($1, $2, 'admin', now() + interval '1 hour')",
        [user, "plain-token-value-that-is-not-a-sha256-hex-digest-at-all-xxxxxxx"],
      );
      expect(err?.constraint).toBe("sessions_token_hash_hex");
    });
  });

  it("requires a different user to decide an approval", async () => {
    await inTx(async (db) => {
      const staff = await createUser(db);
      const a = await one<{ id: string }>(
        db,
        `INSERT INTO admin_approvals (action, payload, requested_by, expires_at)
         VALUES ('price.update', '{}', $1, now() + interval '1 day') RETURNING id`,
        [staff],
      );
      const err = await dbError(
        db,
        "UPDATE admin_approvals SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1",
        [a.id, staff],
      );
      expect(err?.constraint).toBe("admin_approvals_not_self_decided");
    });
  });

  it("keeps approval requests immutable and decisions final", async () => {
    await inTx(async (db) => {
      const staff = await createUser(db);
      const admin = await createUser(db);
      expect(
        (await dbError(
          db,
          `INSERT INTO admin_approvals (action, payload, status, requested_by, decided_by, decided_at, expires_at)
           VALUES ('price.update', '{}', 'approved', $1, $2, now(), now() + interval '1 day')`,
          [staff, admin],
        ))?.message,
      ).toMatch(/created pending/);
      const a = await one<{ id: string }>(
        db,
        `INSERT INTO admin_approvals (action, payload, requested_by, expires_at)
         VALUES ('price.update', '{"price": "1000"}', $1, now() + interval '1 day') RETURNING id`,
        [staff],
      );
      expect(
        (await dbError(db, `UPDATE admin_approvals SET payload = '{"price": "1"}' WHERE id = $1`, [a.id]))?.message,
      ).toMatch(/request is immutable/);
      expect(
        await dbError(db, "UPDATE admin_approvals SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1", [
          a.id,
          admin,
        ]),
      ).toBeNull();
      expect((await dbError(db, "UPDATE admin_approvals SET status = 'pending' WHERE id = $1", [a.id]))?.message).toMatch(
        /cannot change from approved to pending/,
      );
      expect((await dbError(db, "UPDATE admin_approvals SET decided_by = $2 WHERE id = $1", [a.id, staff]))?.message).toMatch(
        /decision is final/,
      );
      expect(await dbError(db, "UPDATE admin_approvals SET status = 'executed', executed_at = now() WHERE id = $1", [a.id])).toBeNull();
      expect((await dbError(db, "DELETE FROM admin_approvals WHERE id = $1", [a.id]))?.message).toMatch(/cannot be deleted/);
    });
  });

  it("never lets a permission key be renamed", async () => {
    await inTx(async (db) => {
      expect((await dbError(db, "UPDATE permissions SET key = 'zz.tmp' WHERE key = 'role.manage'"))?.message).toMatch(
        /keys are immutable/,
      );
      expect(
        (await dbError(db, "UPDATE permissions SET scope_type = NULL WHERE key = 'product.update'"))?.message,
      ).toMatch(/granted scoped/);
      expect(await dbError(db, "UPDATE permissions SET requires_mfa = requires_mfa WHERE key = 'role.manage'")).toBeNull();
    });
  });

  it("refuses TRUNCATE on ledgers and logs", async () => {
    await inTx(async (db) => {
      for (const table of ["audit_logs", "inventory_movements", "accounting_entries", "payment_transactions", "users"]) {
        expect((await dbError(db, `TRUNCATE ${table} CASCADE`))?.message).toMatch(/cannot be truncated/);
      }
    });
  });

  it("validates user-role scopes", async () => {
    await inTx(async (db) => {
      const staff = await createUser(db);
      const userRole = await assignRole(db, staff, "store_staff");
      const err = await dbError(db, "INSERT INTO user_role_scopes (user_role_id, scope_type) VALUES ($1, 'category')", [
        userRole,
      ]);
      expect(err?.constraint).toBe("user_role_scopes_target");
    });
  });
});

describe("audit log", () => {
  async function audit(db: Parameters<typeof roleId>[0], action: string, actor: string | null) {
    await db.query(
      `INSERT INTO audit_logs (actor_type, actor_user_id, action, entity_type, after, ip_address)
       VALUES ('user', $1, $2, 'product', '{"price": "1000"}', '192.0.2.1')`,
      [actor, action],
    );
  }

  it("is hash-chained and verifies", async () => {
    await inTx(async (db) => {
      const user = await createUser(db);
      await setActor(db, user);
      await audit(db, "product.update", user);
      await audit(db, "price.update", user);
      await audit(db, "product.archive", user);
      const rows = await db.query<{ seq: string; prev_hash: Buffer | null; hash: Buffer }>(
        "SELECT seq, prev_hash, hash FROM audit_logs ORDER BY seq",
      );
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows[0]?.prev_hash).toBeNull();
      expect(rows.rows[1]?.prev_hash).toEqual(rows.rows[0]?.hash);
      expect(rows.rows[2]?.prev_hash).toEqual(rows.rows[1]?.hash);
      expect((await one<{ broken: string | null }>(db, "SELECT audit_logs_verify() AS broken")).broken).toBeNull();
    });
  });

  it("ignores client-supplied hashes", async () => {
    await inTx(async (db) => {
      await db.query(
        `INSERT INTO audit_logs (actor_type, action, entity_type, prev_hash, hash)
         VALUES ('system', 'x.y', 'test', '\\x00', '\\x00')`,
      );
      expect((await one<{ broken: string | null }>(db, "SELECT audit_logs_verify() AS broken")).broken).toBeNull();
    });
  });

  it("is append-only", async () => {
    await inTx(async (db) => {
      await audit(db, "product.update", null);
      expect((await dbError(db, "UPDATE audit_logs SET action = 'nothing'"))?.message).toMatch(/append-only/);
      expect((await dbError(db, "DELETE FROM audit_logs"))?.message).toMatch(/append-only/);
    });
  });

  it("detects tampering that bypasses the triggers", async () => {
    await inTx(async (db) => {
      await audit(db, "a.one", null);
      await audit(db, "a.two", null);
      await audit(db, "a.three", null);
      // Simulates a superuser editing a row directly with triggers disabled.
      await db.query("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only");
      const second = await one<{ seq: string }>(db, "SELECT seq FROM audit_logs ORDER BY seq OFFSET 1 LIMIT 1");
      await db.query(`UPDATE audit_logs SET after = '{"price": "1"}' WHERE seq = $1`, [second.seq]);
      const broken = await one<{ broken: string }>(db, "SELECT audit_logs_verify() AS broken");
      expect(broken.broken).toBe(second.seq);
    });
  });

  it("makes login attempts and security events append-only", async () => {
    await inTx(async (db) => {
      await db.query("INSERT INTO login_attempts (identifier, success) VALUES ('test@example.test', false)");
      await db.query("INSERT INTO security_events (type) VALUES ('authz.denied')");
      expect((await dbError(db, "UPDATE login_attempts SET success = true"))?.message).toMatch(/append-only/);
      expect((await dbError(db, "DELETE FROM security_events"))?.message).toMatch(/append-only/);
    });
  });
});
