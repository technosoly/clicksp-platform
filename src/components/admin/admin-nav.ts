/**
 * Admin navigation, grouped by area. Each item lists the permissions that
 * reveal it (any one is enough; empty = every signed-in admin). Hiding an
 * item is only a convenience: the page behind it authorizes on the server
 * and answers 403 to a typed URL.
 *
 * `ready: false` marks areas whose screens arrive in a later phase: the item
 * is shown to the admins who will use it, and its page says so plainly.
 */
export interface AdminNavItem {
  href: string;
  labelKey: string;
  anyOf: readonly string[];
  ready: boolean;
}

export interface AdminNavGroup {
  labelKey: string;
  items: readonly AdminNavItem[];
}

const item = (href: string, labelKey: string, anyOf: readonly string[], ready = false): AdminNavItem => ({ href, labelKey, anyOf, ready });

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { labelKey: "overview", items: [item("/admin", "dashboard", [], true)] },
  {
    labelKey: "catalog",
    items: [
      item("/admin/products", "products", ["product.view"], true),
      item("/admin/categories", "categories", ["category.manage"], true),
      item("/admin/brands", "brands", ["brand.manage"], true),
      item("/admin/motorcycles", "motorcycles", ["vehicle.manage"], true),
    ],
  },
  {
    labelKey: "operations",
    items: [
      item("/admin/inventory", "inventory", ["inventory.view"], true),
      item("/admin/warehouses", "warehouses", ["warehouse.manage"], true),
      item("/admin/orders", "orders", ["order.view"], true),
      item("/admin/customers", "customers", ["customer.view"]),
      item("/admin/approvals", "approvals", ["price.update", "price.update.propose", "inventory.adjust"], true),
    ],
  },
  {
    labelKey: "finance",
    items: [
      item("/admin/accounting", "accounting", ["accounting.view"]),
      item("/admin/reports", "reports", ["report.sales", "report.financial"]),
      item("/admin/shipping", "shipping", ["shipping.configure"], true),
      item("/admin/payments", "payments", ["payment_provider.view"], true),
    ],
  },
  {
    labelKey: "website",
    items: [
      item("/admin/content", "content", ["content.manage", "article.manage", "menu.manage", "banner.manage"]),
      item("/admin/page-builder", "pageBuilder", ["pagebuilder.edit"]),
    ],
  },
  {
    labelKey: "people",
    items: [
      item("/admin/people/users", "users", ["user.manage_staff", "user.manage_admins"], true),
      item("/admin/people/roles", "roles", ["role.manage"], true),
      item("/admin/audit", "audit", ["audit.view_all", "audit.view_business"], true),
    ],
  },
  {
    labelKey: "system",
    items: [
      item("/admin/settings", "settings", ["settings.store", "settings.system"]),
      item("/admin/system", "technical", ["settings.system", "integration.manage", "backup.view", "deployment.view", "monitoring.view"]),
    ],
  },
  { labelKey: "you", items: [item("/admin/account", "account", [], true)] },
];

export function canSee(navItem: AdminNavItem, holds: (key: string) => boolean): boolean {
  return navItem.anyOf.length === 0 || navItem.anyOf.some(holds);
}

/** The groups and items this admin may see; empty groups are dropped. */
export function visibleNav(groups: readonly AdminNavGroup[], holds: (key: string) => boolean): AdminNavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((i) => canSee(i, holds)) }))
    .filter((group) => group.items.length > 0);
}

/** Areas that arrive in later phases, by URL segment (/admin/<segment>). */
export const UPCOMING_SECTIONS: ReadonlyMap<string, AdminNavItem> = new Map(
  ADMIN_NAV.flatMap((g) => g.items)
    .filter((i) => !i.ready)
    .map((i) => [i.href.slice("/admin/".length), i]),
);
