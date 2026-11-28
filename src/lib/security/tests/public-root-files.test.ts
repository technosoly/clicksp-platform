import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The locale proxy must never redirect files served from public/ at the site
// root (e.g. /kvn-push-sw.js, the Kavenegar web-push service worker).
describe("public root files", () => {
  // proxy.ts imports next/server, which vitest can't load, so read its matcher as text.
  const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  const pattern = /matcher:\s*"((?:[^"\\]|\\.)*)"/.exec(source)?.[1];
  if (!pattern) throw new Error("matcher not found in proxy.ts");
  const matcher = new RegExp(`^${JSON.parse(`"${pattern}"`)}$`);

  it("serves /kvn-push-sw.js without the locale proxy", () => {
    expect(matcher.test("/kvn-push-sw.js")).toBe(false);
    expect(matcher.test("/fa")).toBe(true);
  });

  it("keeps the Kavenegar service worker file in public/", () => {
    const body = readFileSync(join(process.cwd(), "public", "kvn-push-sw.js"), "utf8");
    expect(body.trim()).toBe('importScripts("https://cdn.kavenegar.com/sdk/sw.js");');
  });
});
