/**
 * Readable names for permission keys and modules. Keys contain dots, which
 * next-intl treats as nesting, so messages use "_" instead
 * (price.update.propose -> price_update_propose). Unknown keys fall back to
 * the raw key, so a new permission never breaks the screen.
 */
type T = ((key: string) => string) & { has: (key: string) => boolean };

export function permissionLabel(t: T, key: string): string {
  const id = `keys.${key.replaceAll(".", "_")}`;
  return t.has(id) ? t(id) : key;
}

export function moduleLabel(t: T, module: string): string {
  const id = `modules.${module}`;
  return t.has(id) ? t(id) : module;
}
