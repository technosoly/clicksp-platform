/**
 * Pure authorization decision: does an actor's effective permission set allow
 * `key` on a resource? Deny by default. The service layer
 * (rbac/service/authorize.ts) loads the actor, records denials and enforces
 * step-up MFA. No I/O here.
 */

export interface EffectiveGrant {
  /** Held without a scope: covers every resource. Wins over scoped grants. */
  unscoped: boolean;
  /** Categories covered by scoped grants of this permission. */
  categoryIds: ReadonlySet<string>;
  /** Warehouses covered by scoped grants of this permission. */
  warehouseIds: ReadonlySet<string>;
  requiresMfa: boolean;
}

/** Permission key -> what the actor holds. Built from active, unexpired roles only. */
export type EffectivePermissions = ReadonlyMap<string, EffectiveGrant>;

/**
 * What the action touches, for scoped grants. A scoped grant allows only when
 * the resource names at least one category/warehouse and every one of them is
 * in scope (a product in two categories needs both).
 */
export interface ResourceScope {
  categoryIds?: readonly string[];
  warehouseIds?: readonly string[];
}

export type Decision =
  | { allowed: true; requiresMfa: boolean }
  | { allowed: false; reason: "not_granted" | "out_of_scope" | "scope_unknown" };

export function decide(perms: EffectivePermissions, key: string, resource?: ResourceScope): Decision {
  const grant = perms.get(key);
  if (!grant) return { allowed: false, reason: "not_granted" };
  if (grant.unscoped) return { allowed: true, requiresMfa: grant.requiresMfa };

  const categories = resource?.categoryIds ?? [];
  const warehouses = resource?.warehouseIds ?? [];
  // A scoped grant without a concrete resource cannot be checked: deny.
  if (categories.length === 0 && warehouses.length === 0) return { allowed: false, reason: "scope_unknown" };
  const inScope =
    categories.every((id) => grant.categoryIds.has(id)) && warehouses.every((id) => grant.warehouseIds.has(id));
  if (!inScope) return { allowed: false, reason: "out_of_scope" };
  return { allowed: true, requiresMfa: grant.requiresMfa };
}

/**
 * Whether the actor holds the permission at all (any scope). Used only to
 * show or hide UI; the action itself still calls authorize().
 */
export function holds(perms: EffectivePermissions, key: string): boolean {
  return perms.has(key);
}

export interface GrantRow {
  key: string;
  isScoped: boolean;
  requiresMfa: boolean;
  scopeType: "category" | "warehouse" | null;
  /** Scope rows of the user-role that carried this grant. */
  categoryIds: readonly string[];
  warehouseIds: readonly string[];
}

/** Merges the grant rows of all the actor's roles into one effective set. */
export function buildEffectivePermissions(rows: readonly GrantRow[]): EffectivePermissions {
  const map = new Map<string, { unscoped: boolean; categoryIds: Set<string>; warehouseIds: Set<string>; requiresMfa: boolean }>();
  for (const row of rows) {
    let grant = map.get(row.key);
    if (!grant) {
      grant = { unscoped: false, categoryIds: new Set(), warehouseIds: new Set(), requiresMfa: row.requiresMfa };
      map.set(row.key, grant);
    }
    if (!row.isScoped) {
      grant.unscoped = true;
      continue;
    }
    // A scoped grant only counts the scope rows of its own kind.
    if (row.scopeType === "category") row.categoryIds.forEach((id) => grant.categoryIds.add(id));
    if (row.scopeType === "warehouse") row.warehouseIds.forEach((id) => grant.warehouseIds.add(id));
  }
  return map;
}
