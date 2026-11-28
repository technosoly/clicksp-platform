"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { needsStrictCsp } from "@/lib/security/csp";

/**
 * Rendered only on documents that loaded Kavenegar's web-push SDK (storefront
 * pages with the static CSP). Third-party script must never run on sign-in,
 * account, cart or checkout pages, but an in-app link keeps the same document
 * (and its scripts and CSP) alive. So:
 * - a click on a link to such a page skips client-side navigation and lets
 *   the browser load it fresh (it gets the strict policy and no SDK);
 * - any other way of arriving there (router.push, a server redirect) shows
 *   nothing of that page in this document and reloads it.
 */
export function StrictPageGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !needsStrictCsp(url.pathname)) return;
      // Stop the event before React (and so next/link) sees it; the browser's own navigation still happens.
      e.stopPropagation();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (needsStrictCsp(pathname)) window.location.reload();
  }, [pathname]);

  return needsStrictCsp(pathname) ? null : children;
}
