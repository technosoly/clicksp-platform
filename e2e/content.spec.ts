import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Information pages end to end: a Business Admin writes the contact page in
 * both languages, and visitors read it on the site and find it in the footer.
 * The text is synthetic and marked TEST.
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
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Content') RETURNING id", [username]);
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

test("a Business Admin writes an information page and visitors read it", async ({ page }, info) => {
  const id = randomUUID().slice(0, 8);
  // Projects run side by side: each writes its own page so neither overwrites the other.
  const { key, name } = info.project.name === "mobile" ? { key: "shipping", name: "Shipping and delivery" } : { key: "contact", name: "Contact us" };
  await signInBusinessAdmin(page);
  await page.goto("/en/admin/content");
  await page.getByTestId("admin-info-pages").getByRole("link", { name }).click();
  await expect(page.getByTestId("admin-info-page-heading")).toContainText(name);
  await page.getByLabel("Persian title").fill(`TEST تماس ${id}`);
  await page.getByLabel("Persian text").fill(`## ساعت کاری\nTEST ${id}\n\n- شنبه تا چهارشنبه`);
  await page.getByLabel("English title").fill(`TEST Contact ${id}`);
  await page.getByLabel("English text").fill(`## Opening hours\nTEST ${id}\n\n- <script>window.pwned = 1</script>`);
  await page.getByTestId("admin-info-page-form-submit").click();
  await expect(page.getByTestId("form-success")).toContainText("Published");

  await page.goto(`/en/pages/${key}`);
  await expect(page.getByTestId("info-page-title")).toHaveText(`TEST Contact ${id}`);
  await expect(page.getByRole("heading", { name: "Opening hours" })).toBeVisible();
  // Typed markup is shown as text, never run.
  await expect(page.getByTestId("info-page").getByText("<script>window.pwned = 1</script>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();

  await page.goto("/fa");
  await page.getByTestId("footer-pages").getByRole("link", { name: `TEST تماس ${id}` }).click();
  await expect(page).toHaveURL(new RegExp(`/fa/pages/${key}$`));
  await expect(page.getByTestId("info-page-title")).toHaveText(`TEST تماس ${id}`);
});

test("a page that hasn't been written is not found", async ({ page }) => {
  const response = await page.goto("/fa/pages/no-such-page");
  expect(response?.status()).toBe(404);
});
