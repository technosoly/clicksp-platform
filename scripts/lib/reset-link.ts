/**
 * Server-side account recovery for admins (`pnpm admin:reset-link`): issues a
 * one-time password reset link for an admin account, optionally removing its
 * two-factor enrolment, and signs the account out everywhere. Meant for the
 * owner locked out of the only Super Admin account; other admins are reset
 * from the admin panel. Uses node-postgres so it runs under plain Node.
 *
 * Erasable TypeScript only (Node type stripping).
 */
import type { ClientBase } from "pg";
import { randomToken, sha256Hex } from "../../src/lib/security/tokens.ts";

export const CLI_RESET_TTL_MINUTES = 30;

export type ResetLinkResult =
  | { ok: true; userId: string; token: string; expiresAt: Date; mfaRemoved: boolean }
  | { ok: false; error: "not_found" | "not_admin" | "disabled" };

export async function issueResetLink(
  db: ClientBase,
  input: { username: string; resetMfa: boolean },
  now = new Date(),
): Promise<ResetLinkResult> {
  const username = input.username.trim().toLowerCase();
  const user = await db.query<{ id: string; status: string; level: number | null }>(
    `SELECT u.id, u.status::text AS status,
            (SELECT min(r.level) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND r.level BETWEEN 1 AND 3) AS level
       FROM users u WHERE u.username = $1`,
    [username],
  );
  const row = user.rows[0];
  if (!row) return { ok: false, error: "not_found" };
  if (row.level === null) return { ok: false, error: "not_admin" };
  if (row.status !== "active") return { ok: false, error: "disabled" };

  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + CLI_RESET_TTL_MINUTES * 60_000);
  await db.query("BEGIN");
  try {
    await db.query(
      `UPDATE verification_tokens SET consumed_at = $2
        WHERE user_id = $1 AND purpose IN ('admin_invite', 'password_reset') AND consumed_at IS NULL`,
      [row.id, now],
    );
    await db.query(
      `INSERT INTO verification_tokens (purpose, identifier, user_id, value_hash, expires_at, created_at)
       VALUES ('password_reset', $1, $2, $3, $4, $5)`,
      [username, row.id, sha256Hex(token), expiresAt, now],
    );
    let mfaRemoved = false;
    if (input.resetMfa) {
      const removed = await db.query("DELETE FROM user_mfa WHERE user_id = $1", [row.id]);
      await db.query("UPDATE users SET two_factor_enabled = false WHERE id = $1", [row.id]);
      mfaRemoved = (removed.rowCount ?? 0) > 0;
    }
    await db.query(
      `UPDATE sessions SET revoked_at = $2, revoked_reason = 'recovery_cli' WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.id, now],
    );
    await db.query(
      `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, after)
       VALUES ('system', 'auth.recovery_link_issued', 'user', $1, $2::jsonb)`,
      [row.id, JSON.stringify({ via: "cli", mfaRemoved, expiresAt: expiresAt.toISOString() })],
    );
    await db.query("COMMIT");
    return { ok: true, userId: row.id, token, expiresAt, mfaRemoved };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
