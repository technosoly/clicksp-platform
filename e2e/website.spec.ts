import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Website content end to end: a Business Admin adds a home page banner,
 * publishes an article and adds a header link; a visitor sees all three.
 * Data is synthetic and marked TEST.
 */
const PASSWORD = "e2e test password 123";

async function sql<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function signInBusinessAdmin(page: Page) {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Website') RETURNING id", [username]);
  await sql("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [user!.id, user!.id, await hashPassword(PASSWORD)]);
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'business_admin'", [user!.id]);
  await page.goto("/en/admin/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByTestId("admin-login-submit").click();
  await expect(page).toHaveURL(/\/en\/admin\/mfa\/setup$/);
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Code from the app").fill(totp(secret, Date.now()));
  await page.getByTestId("admin-mfa-setup-submit").click();
  await page.getByTestId("continue-to-admin").click();
  await expect(page).toHaveURL(/\/en\/admin$/);
}

test("a Business Admin adds a banner, an article and a header link; visitors see them", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const id = randomUUID().slice(0, 8);
  await signInBusinessAdmin(page);

  // Banner with a wide picture.
  await page.goto("/en/admin/banners");
  const form = page.getByTestId("admin-banner-create");
  const picture = await sharp({ create: { width: 1600, height: 540, channels: 3, background: "#c65a19" } }).png().toBuffer();
  await form.getByLabel("Wide-screen picture").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: picture });
  await form.locator('input[name="faTitle"]').fill(`TEST حراج ${id}`);
  await form.locator('input[name="enTitle"]').fill(`TEST sale ${id}`);
  await form.locator('input[name="enCta"]').fill("Shop now");
  await form.getByLabel("Link").fill("/motorcycles");
  await form.locator('input[name="sortOrder"]').fill("0");
  await page.getByTestId("admin-banner-create-submit").click();
  await expect(page.getByTestId("admin-banner-created")).toBeVisible();

  // Article, published.
  await page.goto("/en/admin/articles/new");
  const article = page.getByTestId("admin-article-create");
  await article.getByLabel("Status").selectOption("published");
  await article.locator('input[name="faTitle"]').fill(`TEST راهنمای لنت ${id}`);
  await article.locator('textarea[name="faBody"]').fill("## مراحل\n\n- چرخ را باز کنید\n- لنت را عوض کنید");
  await article.locator('input[name="enTitle"]').fill(`TEST brake pad guide ${id}`);
  await article.locator('textarea[name="enBody"]').fill("Steps.\n\n- Remove the wheel");
  await page.getByTestId("admin-article-create-submit").click();
  await expect(page.getByTestId("admin-article-created")).toBeVisible();

  // Header link (one device run only: both runs share the one header menu).
  if (testInfo.project.name === "desktop") {
    await page.goto("/en/admin/menus");
    const menu = page.getByTestId("admin-menu-header-form");
    await menu.getByLabel("Link 1 Persian label").fill(`TEST راهنما ${id}`);
    await menu.getByLabel("Link 1 English label").fill(`TEST guides ${id}`);
    await menu.getByLabel("Link 1 address").fill("/blog");
    await page.getByTestId("admin-menu-header-form-submit").click();
    await expect(menu.getByTestId("form-success")).toBeVisible();
  }

  const visitor = await browser.newPage();
  await visitor.goto("/en");
  const slide = visitor.getByTestId("home-slide").filter({ hasText: `TEST sale ${id}` });
  await expect(slide).toBeAttached();
  await expect(slide.getByRole("link")).toHaveAttribute("href", "/en/motorcycles");
  if (testInfo.project.name === "desktop") await expect(visitor.getByTestId("header-menu-link").filter({ hasText: `TEST guides ${id}` })).toBeVisible();

  await visitor.getByTestId("footer-blog").click();
  await expect(visitor.getByTestId("blog-heading")).toBeVisible();
  await visitor.getByTestId("blog-card").filter({ hasText: `TEST brake pad guide ${id}` }).click();
  await expect(visitor.getByTestId("article-title")).toHaveText(`TEST brake pad guide ${id}`);

  await visitor.goto("/fa/blog");
  await visitor.getByTestId("blog-card").filter({ hasText: `TEST راهنمای لنت ${id}` }).click();
  await expect(visitor.getByTestId("article-page").getByRole("listitem").filter({ hasText: "لنت را عوض کنید" })).toBeVisible();
  await visitor.close();
});
