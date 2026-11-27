import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { parseHref } from "../domain/links";
import { isMenuKey, MENU_KEYS, MENU_ROWS, MenuDocument, parseMenu, type MenuKey, type MenuRowInput } from "../domain/menu";
import { menusByKeys, saveMenu as saveMenuRow } from "../repo/menu-repo";

/**
 * The store's own links in the header and footer (menu.manage: Super and
 * Business Admins). Each save replaces the menu; the audit keeps the old one.
 */

export type MenuResult = { status: "ok" } | { status: "not_found" } | { status: "invalid"; field: string; row?: number };

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("menu.manage", "not_admin");
  await authorize(actor, "menu.manage");
  return actor.userId;
}

const itemsOf = (document: unknown) => {
  const parsed = MenuDocument.safeParse(document);
  return parsed.success ? parsed.data.items : [];
};

export async function menusForAdmin(actor: Actor) {
  await allow(actor);
  const rows = new Map((await menusByKeys(db(), MENU_KEYS)).map((r) => [r.key, r]));
  return MENU_KEYS.map((key) => {
    const items = itemsOf(rows.get(key)?.document);
    return {
      key,
      rows: Array.from({ length: MENU_ROWS[key] }, (_, i) => ({ fa: items[i]?.label.fa ?? "", en: items[i]?.label.en ?? "", href: items[i]?.href ?? "" })),
      updatedAt: rows.get(key)?.updatedAt ?? null,
    };
  });
}

export async function saveMenu(actor: Actor, key: string, rows: readonly MenuRowInput[]): Promise<MenuResult> {
  const userId = await allow(actor);
  if (!isMenuKey(key)) return { status: "not_found" };
  const parsed = parseMenu(key, rows);
  if ("field" in parsed) return { status: "invalid", field: parsed.field, row: parsed.row };
  await transaction(async (tx) => {
    const before = await saveMenuRow(tx, key, parsed);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "menu.saved", entityType: "menu", entityId: null, before: { key, document: before }, after: { key, document: parsed } });
  });
  return { status: "ok" };
}

export type ShopLink = { label: string; lang: "fa" | "en"; href: { kind: "internal"; path: string } | { kind: "external"; url: string } };

/** A menu's links for the storefront, in the visitor's language when given; invalid entries are left out. */
export async function shopMenu(key: MenuKey, locale: "fa" | "en"): Promise<ShopLink[]> {
  const [row] = await menusByKeys(db(), [key]);
  if (!row || !row.isActive) return [];
  return itemsOf(row.document).flatMap((item) => {
    const href = parseHref(item.href);
    if (!href) return [];
    const en = locale === "en" ? item.label.en : undefined;
    return [{ label: en ?? item.label.fa, lang: en ? ("en" as const) : ("fa" as const), href }];
  });
}
