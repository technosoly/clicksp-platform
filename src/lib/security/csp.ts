/**
 * Content-Security-Policy values (Next.js CSP guide, App Router, Next 16:
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *
 * - Admin and customer account pages are rendered per request, so they get a
 *   strict policy with a fresh nonce: only scripts carrying the nonce (which
 *   Next.js adds to its own scripts) run; 'strict-dynamic' lets those load
 *   the page chunks. No inline event handlers, no eval in production.
 * - Storefront pages are pre-rendered and shared by every visitor, so a nonce
 *   is impossible there; they get a static policy that still blocks other
 *   origins, plugins, framing, <base> hijacking and off-site form posts, but
 *   has to allow inline scripts (Next.js inlines its hydration data).
 *
 * Every source is 'self': fonts are bundled and nothing is loaded from other
 * origins (CLAUDE.md, Iranian hosting). One exception on storefront pages:
 * frames from www.google.com/maps/embed on the Contact page only, for its map, which
 * loads only when the visitor asks for it (docs/DEPLOYMENT.md). And, when
 * web push is on (src/lib/web-push/kavenegar.ts), Kavenegar's SDK on
 * storefront pages: scripts, styles and images from cdn.kavenegar.com and
 * requests to Kavenegar's own hosts. Strict pages never load it.
 */

export type CspKind = "strict" | "static";

/**
 * Request header the proxy sets on every page request (always overwritten,
 * never taken from the browser) so the root layout knows which policy the
 * page gets: it adds the web-push loader on "static" pages only.
 */
export const CSP_KIND_HEADER = "x-clicksp-csp";

/** Admin, the page builder preview, customer sign-in, account, cart and checkout pages: rendered per request, nonce policy. */
export function needsStrictCsp(pathname: string): boolean {
  return /^\/(?:fa|en)\/(?:admin|preview|account|login|cart|checkout)(?:\/|$)/.test(pathname);
}

/** A fresh 128-bit nonce, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The Contact page, the only page that may frame Google's map embed. */
export function allowsMapFrame(pathname: string): boolean {
  return /^\/(?:fa|en)\/contact\/?$/.test(pathname);
}

/** Kavenegar web push SDK (storefront pages only). */
const KAVENEGAR_CDN = "https://cdn.kavenegar.com";
const KAVENEGAR_HOSTS = "https://*.kavenegar.com";

export function buildCsp(kind: CspKind, options: { nonce?: string; dev: boolean; mapFrame?: boolean; webPush?: boolean }): string {
  const devEval = options.dev ? " 'unsafe-eval'" : "";
  const push = kind === "static" && options.webPush === true;
  const pushCdn = push ? ` ${KAVENEGAR_CDN}` : "";
  const script =
    kind === "strict"
      ? `'self' 'nonce-${options.nonce ?? ""}' 'strict-dynamic'${devEval}`
      : `'self' 'unsafe-inline'${pushCdn}${devEval}`;
  // Inline style attributes (e.g. next/image) are allowed; style elements need the nonce on strict pages.
  const style = kind === "strict" ? `'self' 'nonce-${options.nonce ?? ""}'` : `'self' 'unsafe-inline'${pushCdn}`;
  const directives = [
    "default-src 'self'",
    `script-src ${script}`,
    `style-src ${style}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data:${pushCdn}`,
    "font-src 'self'",
    // Contact page only: Google's map embed, loaded when the visitor presses "show map".
    ...(kind === "static" && options.mapFrame ? ["frame-src 'self' https://www.google.com/maps/embed"] : []),
    // Dev only: hot reload talks to the dev server over a WebSocket.
    `connect-src 'self'${push ? ` ${KAVENEGAR_HOSTS}` : ""}${options.dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!options.dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
