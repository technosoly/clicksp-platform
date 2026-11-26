import { describe, expect, it } from "vitest";
import { buildEffectivePermissions, type EffectivePermissions } from "../domain/authorize";
import { canEditRoleLevel, canGrantPermission, diffGrants, manageableLevels, userManagementPermission } from "../domain/escalation";
import { defaultGrants, SYSTEM_ROLES } from "../domain/permission-catalogue";

function bundle(key: "super_admin" | "business_admin" | "store_staff"): EffectivePermissions {
  const role = SYSTEM_ROLES.find((r) => r.key === key)!;
  return buildEffectivePermissions(
    defaultGrants(role).map((g) => ({ key: g.key, isScoped: false, requiresMfa: false, scopeType: null, categoryIds: [], warehouseIds: [] })),
  );
}
const actor = (level: number, key: "super_admin" | "business_admin" | "store_staff") => ({ userId: "u", level, permissions: bundle(key) });
const perms = (...keys: string[]) => buildEffectivePermissions(keys.map((key) => ({ key, isScoped: false, requiresMfa: false, scopeType: null, categoryIds: [], warehouseIds: [] })));

describe("userManagementPermission (who may manage accounts of which level)", () => {
  it.each([
    ["super_admin", 1, [1, 2, 3]],
    ["business_admin", 2, [3]],
    ["store_staff", 3, []],
  ] as const)("%s manages levels %j", (key, level, levels) => {
    expect(manageableLevels(actor(level, key))).toEqual(levels);
  });

  it("uses user.manage_staff for staff and user.manage_admins for admins", () => {
    expect(userManagementPermission(actor(1, "super_admin"), 3)).toBe("user.manage_staff");
    expect(userManagementPermission(actor(1, "super_admin"), 2)).toBe("user.manage_admins");
    expect(userManagementPermission(actor(2, "business_admin"), 3)).toBe("user.manage_staff");
  });

  it("never lets a level 2 or 3 actor touch levels 1-2, whatever permissions they hold", () => {
    const forged = perms("user.manage_admins", "user.manage_staff");
    for (const level of [2, 3]) {
      expect(userManagementPermission({ userId: "u", level, permissions: forged }, 1)).toBeNull();
      expect(userManagementPermission({ userId: "u", level, permissions: forged }, 2)).toBeNull();
    }
    // Staff can't manage staff even with the permission.
    expect(userManagementPermission({ userId: "u", level: 3, permissions: forged }, 3)).toBeNull();
  });

  it("denies by default: no permission, or invalid levels", () => {
    expect(userManagementPermission({ userId: "u", level: 1, permissions: perms() }, 3)).toBeNull();
    for (const bad of [0, 4, 1.5, Number.NaN]) expect(userManagementPermission(actor(1, "super_admin"), bad)).toBeNull();
  });
});

describe("role editing guards", () => {
  it("edits only strictly lower levels, never level 1", () => {
    expect(canEditRoleLevel(1, 1)).toBe(false);
    expect(canEditRoleLevel(1, 2)).toBe(true);
    expect(canEditRoleLevel(1, 3)).toBe(true);
    expect(canEditRoleLevel(2, 2)).toBe(false);
    expect(canEditRoleLevel(2, 3)).toBe(true);
    expect(canEditRoleLevel(3, 3)).toBe(false);
    expect(canEditRoleLevel(1, 0)).toBe(false);
  });

  it("grants only held permissions; .propose counts as held through its base permission", () => {
    const p = perms("price.update", "inventory.view");
    expect(canGrantPermission(p, "price.update")).toBe(true);
    expect(canGrantPermission(p, "price.update.propose")).toBe(true);
    expect(canGrantPermission(p, "inventory.adjust.propose")).toBe(false);
    expect(canGrantPermission(p, "role.manage")).toBe(false);
    expect(canGrantPermission(p, ".propose")).toBe(false);
  });

  it("diffs grants", () => {
    expect(
      diffGrants(
        [
          { key: "a", isScoped: false },
          { key: "b", isScoped: true },
          { key: "c", isScoped: false },
        ],
        [
          { key: "b", isScoped: false },
          { key: "c", isScoped: false },
          { key: "d", isScoped: true },
        ],
      ),
    ).toEqual({ added: [{ key: "d", isScoped: true }], removed: ["a"], rescoped: [{ key: "b", isScoped: false }] });
  });
});
