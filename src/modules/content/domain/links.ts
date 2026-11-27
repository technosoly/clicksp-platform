/**
 * Links an admin types into menus and banners. Only two shapes are taken:
 * a path inside the store ("/c/brakes", shown in the visitor's language) or
 * a full https:// address elsewhere. Nothing else can become a link, so a
 * menu or banner can't carry "javascript:", "//evil.example" or "/\evil".
 * The database checks banners the same way.
 */
export type SafeHref = { kind: "internal"; path: string } | { kind: "external"; url: string };

// Control and bidi-override characters, and backslashes.
const CONTROL = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069\\]/;
export const HREF_MAX = 500;

export function parseHref(input: string): SafeHref | null {
  const value = input.trim();
  if (!value || value.length > HREF_MAX || CONTROL.test(value) || /\s/.test(value)) return null;
  if (value.startsWith("/")) {
    // A locale prefix is added by the link itself; "/fa/..." or "/en/..." would double it.
    const path = value.replace(/^\/(fa|en)(?=\/|$)/, "") || "/";
    // Checked after the prefix is gone: "/fa//evil.example" must not become "//evil.example".
    if (!/^\/(?![/\\])/.test(path)) return null;
    // No "." or ".." segments (raw or percent-encoded), so the path can't climb out of the store.
    if (path.split(/[/?#]/).some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return null;
    return { kind: "internal", path };
  }
  if (/^https:\/\/[^/\\]/.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
      return { kind: "external", url: url.toString() };
    } catch {
      return null;
    }
  }
  return null;
}

/** The stored form of a link (path or URL). */
export const hrefText = (href: SafeHref) => (href.kind === "internal" ? href.path : href.url);
