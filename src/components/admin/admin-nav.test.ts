import { describe, expect, it } from "vitest";
import { defaultGrants, SYSTEM_ROLES } from "@/modules/rbac/domain/permission-catalogue";
import { ADMIN_NAV, UPCOMING_SECTIONS, visibleNav } from "./admin-nav";

const hrefsFor = (key: string) => {
  const held = new Set(defaultGrants(SYSTEM_ROLES.find((r) => r.key === key)!).map((g) => g.key));
  return visibleNav(ADMIN_NAV, (k) => held.has(k)).flatMap((g) => g.items.map((i) => i.href));
};

describe("admin navigation per level (default bundles)", () => {
  it("Super Admin sees everything", () => {
    expect(hrefsFor("super_admin")).toEqual(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href)));
  });

  it("Business Admin: no roles, page builder or technical area", () => {
    const hrefs = hrefsFor("business_admin");
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/people/users", "/admin/accounting", "/admin/reports", "/admin/audit", "/admin/settings", "/admin/content", "/admin/banners", "/admin/menus"]));
    for (const hidden of ["/admin/people/roles", "/admin/page-builder", "/admin/system"]) expect(hrefs).not.toContain(hidden);
  });

  it("Store Staff: catalog, stock, orders and their own approval requests only", () => {
    const hrefs = hrefsFor("store_staff");
    expect(hrefs).toEqual(expect.arrayContaining(["/admin", "/admin/products", "/admin/inventory", "/admin/orders", "/admin/approvals", "/admin/account", "/admin/articles"]));
    for (const hidden of ["/admin/banners", "/admin/menus", "/admin/people/users", "/admin/people/roles", "/admin/accounting", "/admin/reports", "/admin/customers", "/admin/audit", "/admin/settings", "/admin/system", "/admin/payments", "/admin/page-builder", "/admin/content", "/admin/imports", "/admin/returns"]) {
      expect(hrefs).not.toContain(hidden);
    }
  });

  it("an admin with no permissions sees only the dashboard and their account", () => {
    expect(visibleNav(ADMIN_NAV, () => false).flatMap((g) => g.items.map((i) => i.href))).toEqual(["/admin", "/admin/account"]);
  });

  it("upcoming areas are single URL segments that don't clash with built screens", () => {
    for (const segment of UPCOMING_SECTIONS.keys()) expect(segment).toMatch(/^[a-z-]+$/);
    expect(UPCOMING_SECTIONS.has("people")).toBe(false);
    expect(UPCOMING_SECTIONS.has("account")).toBe(false);
  });
});
