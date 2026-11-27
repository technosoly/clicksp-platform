import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, needsStrictCsp } from "../csp";

describe("Content-Security-Policy", () => {
  it("uses the nonce policy on admin, account and customer sign-in pages only", () => {
    for (const path of ["/fa/admin", "/en/admin/login", "/fa/admin/people/users", "/fa/account", "/en/login", "/fa/cart", "/en/checkout"]) expect(needsStrictCsp(path)).toBe(true);
    for (const path of ["/fa", "/en/products/x", "/fa/administrator", "/fa/loginx", "/admin", "/fa/cartx"]) expect(needsStrictCsp(path)).toBe(false);
  });

  it("strict: nonce + strict-dynamic, no unsafe-inline scripts, no eval in production", () => {
    const csp = buildCsp("strict", { nonce: "abc", dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests"]) expect(csp).toContain(d);
  });

  it("static storefront policy still blocks other origins, plugins and framing", () => {
    const csp = buildCsp("static", { dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("nonce-");
    expect(csp).not.toMatch(/https?:/);
  });

  it("development allows eval and the hot-reload socket", () => {
    const csp = buildCsp("strict", { nonce: "n", dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("nonces are random 128-bit base64 values", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
