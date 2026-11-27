import type { RequestMeta } from "@/lib/http/request-meta";
import type { Actor } from "@/modules/rbac/domain/actor";
import { loadEffectivePermissions } from "@/modules/rbac/service/authorize";
import { one, pool, uid } from "./helpers";

/** Synthetic admin actors for service-level integration tests. */

export type Level = "super_admin" | "business_admin" | "store_staff";
const LEVEL: Record<Level, number> = { super_admin: 1, business_admin: 2, store_staff: 3 };
let ip = 0;

export const meta = (): RequestMeta => {
  ip += 1;
  return { ipAddress: `198.51.100.${(ip % 250) + 1}`, userAgent: "vitest", requestId: null };
};

export async function q<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

export async function actorFor(level: Level, scopeCategoryIds: string[] = [], scopeWarehouseIds: string[] = []): Promise<Actor & { userId: string }> {
  const client = await pool.connect();
  try {
    const user = await one<{ id: string }>(client, "INSERT INTO users (username, name) VALUES ($1, 'TEST ADMIN') RETURNING id", [`test-adm-${uid().toLowerCase()}`]);
    const ur = await one<{ id: string }>(
      client,
      `INSERT INTO user_roles (user_id, role_id, expires_at)
       SELECT $1, id, CASE WHEN level = 1 THEN now() + interval '1 day' END FROM roles WHERE key = $2 RETURNING id`,
      [user.id, level],
    );
    for (const categoryId of scopeCategoryIds) {
      await client.query("INSERT INTO user_role_scopes (user_role_id, scope_type, category_id) VALUES ($1, 'category', $2)", [ur.id, categoryId]);
    }
    for (const warehouseId of scopeWarehouseIds) {
      await client.query("INSERT INTO user_role_scopes (user_role_id, scope_type, warehouse_id) VALUES ($1, 'warehouse', $2)", [ur.id, warehouseId]);
    }
    return { kind: "admin", userId: user.id, sessionId: null, level: LEVEL[level], permissions: await loadEffectivePermissions(user.id), mfaVerifiedAt: new Date(), meta: meta() };
  } finally {
    client.release();
  }
}

export const testNames = (label: string) => ({ faName: `TEST ${label} ${uid()}`, faSlug: "", enName: "", enSlug: "" });
