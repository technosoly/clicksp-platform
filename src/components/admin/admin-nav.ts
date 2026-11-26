/**
 * Admin navigation. Each item names the permission that reveals it; the page
 * behind it still authorizes on the server. Phase 4 has only the dashboard;
 * Phase 5 adds users, roles and the other sections here.
 */
export interface AdminNavItem {
  href: string;
  labelKey: string;
  /** null = every signed-in admin. */
  permission: string | null;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [{ href: "/admin", labelKey: "dashboard", permission: null }];

export function visibleNav(items: readonly AdminNavItem[], holds: (key: string) => boolean): AdminNavItem[] {
  return items.filter((item) => item.permission === null || holds(item.permission));
}
