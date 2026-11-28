import { expect, test } from "@playwright/test";

/**
 * Kavenegar web push: storefront pages add the SDK's deferred tag to <head>
 * after the load event; admin, sign-in, cart and checkout pages never do.
 * The CDN is a foreign dependency, so these tests make it fail (refused, or
 * hanging) and check the page still loads, hydrates and logs no CSP errors.
 */

const SDK = /^https:\/\/cdn\.kavenegar\.com\/sdk\/page\.js\?appId=[0-9a-f-]{36}$/;

test.describe("Kavenegar web push", () => {
  test("storefront: the deferred SDK tag lands in <head> after load, allowed by the CSP", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    // Serve an empty script instead of reaching the real CDN.
    await page.route("https://cdn.kavenegar.com/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "window.__kvnLoaded = true;" }));
    const res = await page.goto("/fa");
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("https://cdn.kavenegar.com");
    const tag = page.locator("head script#kvn-web-push");
    await expect(tag).toHaveCount(1);
    expect(await tag.evaluate((s: HTMLScriptElement) => ({ src: s.src, defer: s.defer, charset: s.charset }))).toEqual(expect.objectContaining({ defer: true, charset: "utf-8" }));
    expect(await tag.getAttribute("src")).toMatch(SDK);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __kvnLoaded?: boolean }).__kvnLoaded)).toBe(true);
    expect(violations).toEqual([]);
  });

  test("a refused or hanging CDN does not hold the page back", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Hang forever: a filtered host often drops packets instead of refusing.
    await page.route("https://cdn.kavenegar.com/**", () => undefined);
    const start = Date.now();
    await page.goto("/en", { waitUntil: "load" });
    expect(Date.now() - start).toBeLessThan(15_000);
    await expect(page.locator("main#main")).toBeVisible();
    await expect(page.locator("head script#kvn-web-push")).toHaveCount(1);
    await page.unroute("https://cdn.kavenegar.com/**");
    await page.route("https://cdn.kavenegar.com/**", (route) => route.abort("connectionrefused"));
    await page.goto("/fa", { waitUntil: "load" });
    await expect(page.locator("main#main")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("admin, sign-in, cart and checkout pages never load it", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith("https://cdn.kavenegar.com")) requested.push(r.url());
    });
    for (const path of ["/fa/admin/login", "/en/login", "/fa/cart", "/fa/checkout"]) {
      const res = await page.goto(path, { waitUntil: "load" });
      expect(res?.headers()["content-security-policy"] ?? "").not.toContain("kavenegar");
      await expect(page.locator("script#kvn-web-push, script#kvn-web-push-loader")).toHaveCount(0);
    }
    expect(requested).toEqual([]);
  });

  test("a browser cannot ask for the storefront loader on a strict page", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-clicksp-csp": "static" });
    await page.goto("/fa/cart", { waitUntil: "load" });
    await expect(page.locator("script#kvn-web-push-loader")).toHaveCount(0);
  });
});
