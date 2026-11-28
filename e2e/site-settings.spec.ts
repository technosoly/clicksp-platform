import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Site appearance end to end: a Business Admin sets the site name, an
 * announcement bar, a footer note and a social link, and visitors see them
 * on every page. The text is synthetic and marked TEST; the shared setting
 * is removed afterwards so other tests see the built-in wording.
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

async function signIn(page: Page, role: string) {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Site') RETURNING id", [username]);
  await sql("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [user!.id, user!.id, await hashPassword(PASSWORD)]);
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2", [user!.id, role]);
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

test.afterAll(async () => {
  await sql("DELETE FROM store_settings WHERE key = 'store.site'");
});

test("a Business Admin changes the site's name, announcement, footer and social links", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the setting is shared; the desktop project writes it");
  const id = randomUUID().slice(0, 8);
  await signIn(page, "business_admin");
  await page.goto("/en/admin/content");
  await page.getByTestId("admin-site-part-site").click();
  await expect(page.getByTestId("admin-site-heading")).toContainText("Site appearance");
  // The built-in wording shows as a placeholder.
  await expect(page.getByTestId("site-name-en")).toHaveAttribute("placeholder", "Clicksp Spare Parts");

  await page.getByTestId("site-name-fa").fill(`TEST نام ${id}`);
  await page.getByTestId("site-announcement-enabled").check();
  await page.getByTestId("site-announcement-fa").fill(`TEST اطلاعیه ${id}`);
  await page.getByLabel("Link (optional)").fill("/blog");
  await page.getByTestId("site-footerNote-fa").fill(`TEST فوتر ${id}`);
  await page.getByTestId("site-social-telegram").fill("https://evil.test/x");
  await page.getByTestId("admin-site-form-submit").click();
  await expect(page.getByTestId("form-error")).toContainText("Telegram");
  await page.getByTestId("site-social-telegram").fill("https://t.me/TEST");
  await page.getByTestId("admin-site-form-submit").click();
  await expect(page.getByTestId("form-success")).toContainText("Saved");

  await page.goto("/fa");
  await expect(page.getByTestId("header-site-name")).toHaveText(`TEST نام ${id}`);
  await expect(page.getByTestId("announcement-bar")).toContainText(`TEST اطلاعیه ${id}`);
  await expect(page.getByTestId("footer-note")).toHaveText(`TEST فوتر ${id}`);
  await expect(page.getByTestId("footer-social").getByRole("link", { name: "تلگرام" })).toHaveAttribute("href", "https://t.me/TEST");
  await page.getByTestId("announcement-bar").getByRole("link").click();
  await expect(page).toHaveURL(/\/fa\/blog$/);
  await expect(page).toHaveTitle(new RegExp(`TEST نام ${id}`));

  // The English site keeps its built-in name (no English name was written) and shows the Persian notice marked as Persian.
  await page.goto("/en");
  await expect(page.getByTestId("header-site-name")).toHaveText("Clicksp Spare Parts");
  await expect(page.getByTestId("announcement-bar").locator("[lang=fa]")).toContainText(`TEST اطلاعیه ${id}`);

  // Turning the bar off removes it.
  await page.goto("/en/admin/settings");
  await page.getByTestId("site-announcement-enabled").uncheck();
  await page.getByTestId("admin-site-form-submit").click();
  await expect(page.getByTestId("form-success")).toContainText("Saved");
  await page.goto("/fa");
  await expect(page.getByTestId("announcement-bar")).toHaveCount(0);
});

test("Store Staff can't open site appearance", async ({ page }) => {
  await signIn(page, "store_staff");
  const response = await page.goto("/en/admin/settings");
  expect(response?.status()).toBe(403);
});
