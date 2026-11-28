import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { allowsMapFrame, buildCsp, createNonce, needsStrictCsp } from "./src/lib/security/csp";
import { routing } from "./src/lib/i18n/routing";

const handleI18nRouting = createMiddleware(routing);
const dev = process.env.NODE_ENV === "development";
const STATIC_CSP = buildCsp("static", { dev });
const CONTACT_CSP = buildCsp("static", { dev, mapFrame: true });

/**
 * Locale routing (next-intl) plus the Content-Security-Policy header.
 * Admin and account pages get a per-request nonce: it is put on the REQUEST
 * headers too, where Next.js reads it to add the nonce to its own scripts
 * (next-intl passes the request headers on when it rewrites or continues).
 */
export default function proxy(request: NextRequest) {
  const strict = needsStrictCsp(request.nextUrl.pathname);
  const csp = strict ? buildCsp("strict", { nonce: createNonce(), dev }) : allowsMapFrame(request.nextUrl.pathname) ? CONTACT_CSP : STATIC_CSP;
  if (strict) request.headers.set("content-security-policy", csp);
  const response = handleI18nRouting(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Skip API routes, Next.js internals and files with an extension (static assets).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
