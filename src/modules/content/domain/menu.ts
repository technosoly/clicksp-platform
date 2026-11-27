import { z } from "zod";
import { normalizeForStorage } from "@/lib/persian-text";
import { hrefText, parseHref } from "./links";

/**
 * The store's own links in the header and the footer, kept as a small JSON
 * document per menu (`menus.document`): a Persian label, an optional English
 * one and a safe link (see links.ts). The storefront validates the document
 * again before showing it.
 */

export const MENU_KEYS = ["header", "footer"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];
export const MENU_ROWS: Record<MenuKey, number> = { header: 6, footer: 12 };
export const MENU_LABEL_MAX = 60;

const Label = z.string().min(1).max(MENU_LABEL_MAX);
export const MenuItem = z.object({ label: z.object({ fa: Label, en: Label.optional() }), href: z.string().min(1).max(500) });
export type MenuItem = z.infer<typeof MenuItem>;
export const MenuDocument = z.object({ version: z.literal(1), items: z.array(MenuItem).max(12) });
export type MenuDocument = z.infer<typeof MenuDocument>;

export const isMenuKey = (key: string): key is MenuKey => (MENU_KEYS as readonly string[]).includes(key);

const UNSAFE = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;
const label = (s: string) => normalizeForStorage(s.replace(UNSAFE, "")).replace(/\s+/g, " ").trim();

export type MenuRowInput = { fa: string; en: string; href: string };

/** Rows from the editor -> the menu document. Empty rows are skipped; a half-filled row is an error naming its number. */
export function parseMenu(key: MenuKey, rows: readonly MenuRowInput[]): MenuDocument | { field: string; row: number } {
  const items: MenuItem[] = [];
  for (const [i, row] of rows.slice(0, MENU_ROWS[key]).entries()) {
    const fa = label(row.fa);
    const en = label(row.en);
    if (!fa && !en && !row.href.trim()) continue;
    if (!fa) return { field: "menu_label_required", row: i + 1 };
    if (fa.length > MENU_LABEL_MAX || en.length > MENU_LABEL_MAX) return { field: "menu_label_too_long", row: i + 1 };
    const href = parseHref(row.href);
    if (!href) return { field: "invalid_link", row: i + 1 };
    items.push({ label: en ? { fa, en } : { fa }, href: hrefText(href) });
  }
  return { version: 1, items };
}
