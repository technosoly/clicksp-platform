/**
 * Creates the first Super Admin. Used only by the server CLI
 * (`pnpm admin:create-super`); there is deliberately no web form for this
 * (rbac-security skill). Uses node-postgres so it runs under plain Node.
 *
 * Erasable TypeScript only (Node type stripping).
 */
import type { ClientBase } from "pg";
import { checkPasswordPolicy, hashPassword, type PasswordProblem } from "../../src/lib/security/password.ts";

export interface SuperAdminInput {
  username: string;
  email: string | null;
  name: string;
  password: string;
}

export type CreateSuperAdminResult =
  | { ok: true; userId: string }
  | { ok: false; error: "super_admin_exists" | "invalid_username" | "invalid_email" | "invalid_name" | "identifier_taken" | "roles_not_seeded" }
  | { ok: false; error: "weak_password"; problem: PasswordProblem };

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export async function createFirstSuperAdmin(db: ClientBase, raw: SuperAdminInput): Promise<CreateSuperAdminResult> {
  const username = normalizeUsername(raw.username);
  const email = raw.email ? raw.email.trim().toLowerCase() : null;
  const name = raw.name.trim();
  if (!USERNAME.test(username)) return { ok: false, error: "invalid_username" };
  if (email !== null && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "invalid_email" };
  if (name.length === 0 || name.length > 120) return { ok: false, error: "invalid_name" };
  const problem = checkPasswordPolicy(raw.password, [username, email ?? "", name]);
  if (problem) return { ok: false, error: "weak_password", problem };

  const passwordHash = await hashPassword(raw.password);

  await db.query("BEGIN");
  try {
    const result = await insertFirstSuperAdmin(db, { username, email, name, passwordHash });
    await db.query(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/**
 * The database part, inside the caller's open transaction (tests run it in a
 * transaction they roll back). Input must already be validated.
 */
export async function insertFirstSuperAdmin(
  db: ClientBase,
  input: { username: string; email: string | null; name: string; passwordHash: string },
): Promise<CreateSuperAdminResult> {
  const { username, email, name, passwordHash } = input;
  // Two CLI runs at once must not both create a "first" Super Admin.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('clicksp.create_super_admin'))");
  const role = await db.query<{ id: string }>("SELECT id FROM roles WHERE key = 'super_admin' AND level = 1");
  const roleId = role.rows[0]?.id;
  if (!roleId) return { ok: false, error: "roles_not_seeded" };
  const existing = await db.query(
    `SELECT 1 FROM user_roles ur JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = $1 AND u.status = 'active' LIMIT 1`,
    [roleId],
  );
  if (existing.rowCount) return { ok: false, error: "super_admin_exists" };
  const taken = await db.query("SELECT 1 FROM users WHERE username = $1 OR (email IS NOT NULL AND email = $2)", [
    username,
    email,
  ]);
  if (taken.rowCount) return { ok: false, error: "identifier_taken" };

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (username, email, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [username, email, name],
  );
  const userId = user.rows[0]!.id;
  await db.query(
    `INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash, password_changed_at)
     VALUES ($1::uuid, 'credential', $2, $3, now())`,
    [userId, userId, passwordHash],
  );
  await db.query(`INSERT INTO user_profiles (user_id) VALUES ($1)`, [userId]);
  await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await db.query(
    `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, after)
     VALUES ('system', 'user.create_first_super_admin', 'user', $1, $2::jsonb)`,
    [userId, JSON.stringify({ username, email, via: "cli" })],
  );
  return { ok: true, userId };
}
