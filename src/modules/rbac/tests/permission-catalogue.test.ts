import { describe, expect, it } from "vitest";
import { defaultGrants, PERMISSIONS, SYSTEM_ROLES } from "../domain/permission-catalogue";

const role = (key: string) => {
  const r = SYSTEM_ROLES.find((x) => x.key === key);
  if (!r) throw new Error(key);
  return r;
};
const keysOf = (key: string) => defaultGrants(role(key)).map((g) => g.key);

describe("permission catalogue", () => {
  it("has unique, well-formed keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*){1,3}$/);
  });

  it("never grants a permission by default above its level ceiling", () => {
    for (const p of PERMISSIONS) {
      if (p.defaults.businessAdmin) expect({ key: p.key, ok: p.maxLevel >= 2 }).toEqual({ key: p.key, ok: true });
      if (p.defaults.storeStaff) expect({ key: p.key, ok: p.maxLevel >= 3 }).toEqual({ key: p.key, ok: true });
    }
  });

  it("keeps technical and security permissions Super Admin only", () => {
    for (const key of [
      "role.manage", "user.manage_admins", "settings.system", "settings.security", "integration.manage",
      "payment_provider.configure", "backup.run", "deployment.request", "audit.view_all", "monitoring.view",
      "pagebuilder.edit", "pagebuilder.publish", "theme.manage",
    ]) {
      expect(PERMISSIONS.find((p) => p.key === key)?.maxLevel).toBe(1);
    }
  });

  it("gives Store Staff the master prompt's defaults and none of its restrictions", () => {
    const staff = keysOf("store_staff");
    for (const allowed of [
      "product.create", "product.update", "media.upload", "category.manage", "inventory.receive",
      "inventory.issue", "inventory.count", "order.view", "article.manage",
    ]) {
      expect(staff).toContain(allowed);
    }
    for (const denied of [
      "accounting.view", "report.financial", "payment_provider.configure", "settings.system", "role.manage",
      "product.delete_permanent", "price.update", "inventory.view_cost", "order.view_payment", "content.manage",
    ]) {
      expect(staff).not.toContain(denied);
    }
    // Staff price changes go through approval.
    expect(staff).toContain("price.update.propose");
  });

  it("scopes Store Staff grants of scope-capable permissions only", () => {
    for (const grant of defaultGrants(role("store_staff"))) {
      const p = PERMISSIONS.find((x) => x.key === grant.key);
      expect(grant.isScoped).toBe(p?.scope !== null);
    }
    expect(defaultGrants(role("business_admin")).every((g) => !g.isScoped)).toBe(true);
  });

  it("gives Business Admin business access but no technical access", () => {
    const ba = keysOf("business_admin");
    for (const allowed of [
      "price.update", "order.view", "customer.view", "accounting.view", "expense.manage", "income.manage",
      "report.financial", "refund.create", "shipping.configure", "discount.manage", "user.manage_staff",
    ]) {
      expect(ba).toContain(allowed);
    }
    expect(ba.filter((k) => PERMISSIONS.find((p) => p.key === k)?.maxLevel === 1)).toEqual([]);
  });

  it("gives customers no admin permissions", () => {
    expect(defaultGrants(role("customer"))).toEqual([]);
  });
});
