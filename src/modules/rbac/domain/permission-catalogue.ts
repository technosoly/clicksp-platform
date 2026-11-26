/**
 * The permission catalogue: every permission key the application checks, its
 * scope, MFA requirement, the highest role level that may ever hold it, and
 * the default bundles of the three system admin roles.
 *
 * This file is the single source of truth. The system seed (prisma/seed)
 * syncs it into the `permissions` table, and the database refuses to grant a
 * permission to a role whose level is above `maxLevel`
 * (trigger role_permissions_level_guard), so Business Admin and Store Staff
 * roles can never hold Super Admin-only permissions, whatever the role data.
 *
 * Pure data, no I/O. Erasable TypeScript only (runs under Node type stripping).
 * Mirrors .claude/skills/rbac-security/references/permission-catalogue.md.
 */

export type ScopeKind = "category" | "warehouse";

/** Role levels: 1 Super Admin, 2 Business Admin, 3 Store Staff, 0 Customer. */
export type AdminLevel = 1 | 2 | 3;

export type SystemRoleKey = "super_admin" | "business_admin" | "store_staff" | "customer";

export interface PermissionDefinition {
  key: string;
  module: string;
  /**
   * The resource kind this permission can be limited to. A role can hold it
   * unscoped (all resources) or scoped (role_permissions.is_scoped): a scoped
   * grant covers only the categories/warehouses in the user's scope rows and
   * denies when there are none.
   */
  scope: ScopeKind | null;
  /** The action needs a recent MFA check (step-up) when performed. */
  requiresMfa: boolean;
  /** Highest (numerically largest) role level allowed to hold it. 1 = Super Admin only. */
  maxLevel: AdminLevel;
  /** Default grants for the system roles. */
  defaults: { superAdmin: boolean; businessAdmin: boolean; storeStaff: boolean };
}

const SA = { superAdmin: true, businessAdmin: false, storeStaff: false };
const SA_BA = { superAdmin: true, businessAdmin: true, storeStaff: false };
const ALL = { superAdmin: true, businessAdmin: true, storeStaff: true };
const ST_ONLY = { superAdmin: false, businessAdmin: false, storeStaff: true };

function p(
  key: string,
  defaults: PermissionDefinition["defaults"],
  options: { scope?: ScopeKind; mfa?: boolean; maxLevel?: AdminLevel } = {},
): PermissionDefinition {
  return {
    key,
    module: key.split(".")[0] ?? key,
    scope: options.scope ?? null,
    requiresMfa: options.mfa ?? false,
    maxLevel: options.maxLevel ?? 3,
    defaults,
  };
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // Catalog
  p("product.view", ALL, { scope: "category" }),
  p("product.create", ALL, { scope: "category" }),
  p("product.update", ALL, { scope: "category" }),
  p("product.archive", SA_BA),
  p("product.delete_permanent", SA, { mfa: true, maxLevel: 2 }),
  p("media.upload", ALL, { scope: "category" }),
  p("price.update", SA_BA),
  // Staff may propose a price change; it runs only after approval.
  p("price.update.propose", ST_ONLY, { scope: "category" }),
  p("discount.manage", SA_BA),
  p("coupon.manage", SA_BA),
  p("category.manage", ALL, { scope: "category" }),
  p("brand.manage", ALL),
  p("vehicle.manage", ALL),
  p("compatibility.manage", ALL, { scope: "category" }),
  p("compatibility.verify", SA_BA),
  p("import.run", SA_BA),
  p("export.run", SA_BA),

  // Inventory
  p("inventory.view", ALL, { scope: "warehouse" }),
  p("inventory.receive", ALL, { scope: "warehouse" }),
  p("inventory.issue", ALL, { scope: "warehouse" }),
  p("inventory.count", ALL, { scope: "warehouse" }),
  p("inventory.transfer", ALL, { scope: "warehouse" }),
  p("inventory.adjust", SA_BA),
  p("inventory.adjust.propose", ST_ONLY, { scope: "warehouse" }),
  p("inventory.view_cost", SA_BA),
  p("warehouse.manage", SA_BA),

  // Sales
  p("order.view", ALL, { scope: "warehouse" }),
  p("order.view_payment", SA_BA),
  p("order.fulfil", ALL, { scope: "warehouse" }),
  p("order.cancel", SA_BA),
  p("return.manage", SA_BA),
  p("refund.create", SA_BA, { mfa: true }),
  p("customer.view", SA_BA),
  p("customer.manage", SA_BA),

  // Accounting and reports
  p("accounting.view", SA_BA),
  p("accounting.post", SA_BA),
  p("accounting.period_close", SA_BA, { mfa: true }),
  p("expense.manage", SA_BA),
  p("income.manage", SA_BA),
  p("report.financial", SA_BA),
  p("report.sales", SA_BA),

  // Payments and shipping
  p("payment_provider.view", SA_BA),
  p("payment_provider.configure", SA, { mfa: true, maxLevel: 1 }),
  p("shipping.configure", SA_BA),

  // Content
  p("article.manage", ALL, { scope: "category" }),
  p("content.manage", ALL),
  p("menu.manage", SA_BA),
  p("banner.manage", SA_BA),
  p("pagebuilder.edit", SA, { maxLevel: 1 }),
  p("pagebuilder.publish", SA, { maxLevel: 1 }),
  p("theme.manage", SA, { maxLevel: 1 }),

  // Users, roles, settings
  p("user.manage_staff", SA_BA, { mfa: true, maxLevel: 2 }),
  p("user.manage_admins", SA, { mfa: true, maxLevel: 1 }),
  p("role.manage", SA, { mfa: true, maxLevel: 1 }),
  p("settings.store", SA_BA, { maxLevel: 2 }),
  p("settings.system", SA, { mfa: true, maxLevel: 1 }),
  p("settings.security", SA, { mfa: true, maxLevel: 1 }),
  p("integration.manage", SA, { mfa: true, maxLevel: 1 }),

  // Technical operations (Super Admin only)
  p("backup.view", SA, { maxLevel: 1 }),
  p("backup.run", SA, { mfa: true, maxLevel: 1 }),
  p("deployment.view", SA, { maxLevel: 1 }),
  p("deployment.request", SA, { mfa: true, maxLevel: 1 }),
  p("audit.view_all", SA, { maxLevel: 1 }),
  p("audit.view_business", SA_BA, { maxLevel: 2 }),
  p("monitoring.view", SA, { maxLevel: 1 }),
];

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  level: 0 | AdminLevel;
  /** Default display name; the UI shows the translated label for system roles. */
  name: string;
  bundle: keyof PermissionDefinition["defaults"] | null;
  /** Default grants of scope-capable permissions are scoped (Store Staff). */
  scopedGrants: boolean;
}

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  { key: "super_admin", level: 1, name: "Super Admin", bundle: "superAdmin", scopedGrants: false },
  { key: "business_admin", level: 2, name: "Business Admin", bundle: "businessAdmin", scopedGrants: false },
  { key: "store_staff", level: 3, name: "Store Staff", bundle: "storeStaff", scopedGrants: true },
  { key: "customer", level: 0, name: "Customer", bundle: null, scopedGrants: false },
];

export interface DefaultGrant {
  key: string;
  isScoped: boolean;
}

/** Default grants of a system role. */
export function defaultGrants(role: SystemRoleDefinition): DefaultGrant[] {
  const bundle = role.bundle;
  if (bundle === null) return [];
  return PERMISSIONS.filter((perm) => perm.defaults[bundle]).map((perm) => ({
    key: perm.key,
    isScoped: role.scopedGrants && perm.scope !== null,
  }));
}
