import { expect, test } from "@playwright/test";

test.describe("locale routing and direction", () => {
  test("root redirects to Persian, rendered right-to-left", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/fa$/);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "fa-IR");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("home-heading")).toHaveText("کلیک لوازم یدکی");
  });

  test("English is left-to-right", async ({ page }) => {
    await page.goto("/en");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("home-heading")).toHaveText("Clicksp Spare Parts");
  });

  test("language switcher toggles between fa and en", async ({ page }) => {
    await page.goto("/fa");
    await page.getByTestId("lang-en").click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await page.getByTestId("lang-fa").click();
    await expect(page).toHaveURL(/\/fa$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("hreflang alternates are present", async ({ page }) => {
    await page.goto("/fa");
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="fa"]')).toHaveCount(1);
  });

  test("unknown pages show the localized not-found page", async ({ page }) => {
    const response = await page.goto("/en/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  });

  test("layout does not overflow horizontally", async ({ page }) => {
    for (const path of ["/fa", "/en"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("platform endpoints", () => {
  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", jobs: "running" });
  });

  test("search engines stay out until the store opens", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/\s*$/m);
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain("<loc>");
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/fa");
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
