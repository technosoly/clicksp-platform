import { describe, expect, it } from "vitest";
import { buildEffectivePermissions, decide, holds, type GrantRow } from "../domain/authorize";
import { defaultGrants, PERMISSIONS, SYSTEM_ROLES } from "../domain/permission-catalogue";

const row = (key: string, over: Partial<GrantRow> = {}): GrantRow => ({
  key,
  isScoped: false,
  requiresMfa: false,
  scopeType: null,
  categoryIds: [],
  warehouseIds: [],
  ...over,
});

describe("decide()", () => {
  it("denies anything not granted (deny by default)", () => {
    expect(decide(buildEffectivePermissions([]), "product.view")).toEqual({ allowed: false, reason: "not_granted" });
  });

  it("allows unscoped grants on any resource and reports the MFA flag", () => {
    const perms = buildEffectivePermissions([row("refund.create", { requiresMfa: true })]);
    expect(decide(perms, "refund.create")).toEqual({ allowed: true, requiresMfa: true });
  });

  it("limits scoped grants to the user's categories, all of them, and denies when the resource is unknown", () => {
    const perms = buildEffectivePermissions([
      row("product.update", { isScoped: true, scopeType: "category", categoryIds: ["c1", "c2"] }),
    ]);
    expect(decide(perms, "product.update", { categoryIds: ["c1"] }).allowed).toBe(true);
    expect(decide(perms, "product.update", { categoryIds: ["c1", "c2"] }).allowed).toBe(true);
    expect(decide(perms, "product.update", { categoryIds: ["c1", "c3"] })).toEqual({ allowed: false, reason: "out_of_scope" });
    expect(decide(perms, "product.update")).toEqual({ allowed: false, reason: "scope_unknown" });
    expect(decide(perms, "product.update", { categoryIds: [] })).toEqual({ allowed: false, reason: "scope_unknown" });
  });

  it("denies a scoped grant with no scope rows", () => {
    const perms = buildEffectivePermissions([row("inventory.view", { isScoped: true, scopeType: "warehouse" })]);
    expect(decide(perms, "inventory.view", { warehouseIds: ["w1"] }).allowed).toBe(false);
  });

  it("only counts scope rows of the permission's own kind", () => {
    const perms = buildEffectivePermissions([
      row("inventory.view", { isScoped: true, scopeType: "warehouse", categoryIds: ["c1"], warehouseIds: [] }),
    ]);
    expect(decide(perms, "inventory.view", { categoryIds: ["c1"] }).allowed).toBe(false);
  });

  it("lets an unscoped grant from another role win over a scoped one", () => {
    const perms = buildEffectivePermissions([
      row("order.view", { isScoped: true, scopeType: "warehouse", warehouseIds: ["w1"] }),
      row("order.view"),
    ]);
    expect(decide(perms, "order.view", { warehouseIds: ["w9"] }).allowed).toBe(true);
  });

  it("merges scopes from several roles", () => {
    const perms = buildEffectivePermissions([
      row("order.view", { isScoped: true, scopeType: "warehouse", warehouseIds: ["w1"] }),
      row("order.view", { isScoped: true, scopeType: "warehouse", warehouseIds: ["w2"] }),
    ]);
    expect(decide(perms, "order.view", { warehouseIds: ["w1", "w2"] }).allowed).toBe(true);
    expect(holds(perms, "order.view")).toBe(true);
    expect(holds(perms, "order.cancel")).toBe(false);
  });
});

describe("default bundles through decide() (every permission x every admin level)", () => {
  for (const role of SYSTEM_ROLES.filter((r) => r.level > 0)) {
    it(`${role.key}`, () => {
      const grants = defaultGrants(role);
      const perms = buildEffectivePermissions(
        grants.map((g) => {
          const def = PERMISSIONS.find((p) => p.key === g.key)!;
          return row(g.key, {
            isScoped: g.isScoped,
            scopeType: def.scope,
            categoryIds: ["c1"],
            warehouseIds: ["w1"],
            requiresMfa: def.requiresMfa,
          });
        }),
      );
      for (const perm of PERMISSIONS) {
        const granted = role.bundle !== null && perm.defaults[role.bundle];
        const resource = perm.scope === "category" ? { categoryIds: ["c1"] } : perm.scope === "warehouse" ? { warehouseIds: ["w1"] } : undefined;
        expect(decide(perms, perm.key, resource).allowed, `${role.key} ${perm.key}`).toBe(granted);
        if (granted && role.scopedGrants && perm.scope) {
          const outside = perm.scope === "category" ? { categoryIds: ["c2"] } : { warehouseIds: ["w2"] };
          expect(decide(perms, perm.key, outside).allowed, `${role.key} ${perm.key} outside scope`).toBe(false);
        }
      }
    });
  }
});
