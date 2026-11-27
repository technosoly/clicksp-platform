import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Product import end to end: a Business Admin uploads a CSV, reads the check
 * report, confirms, and the products appear in the catalog. The background
 * job runs inside the app server. Data is synthetic and marked TEST.
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
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Import') RETURNING id", [username]);
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

test("a Business Admin imports products from a CSV file", async ({ page }) => {
  test.setTimeout(180_000);
  const id = randomUUID().slice(0, 8);
  const slug = `test-e2e-import-${id}`;
  const [category] = await sql<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id");
  await sql("INSERT INTO category_translations (category_id, locale, name, slug, search_name) VALUES ($1, 'en', $2, $3, $4), ($1, 'fa', $2, $3, $4)", [category!.id, `TEST import ${id}`, slug, `test import ${id}`]);
  await signInBusinessAdmin(page);
  await page.goto("/en/admin/imports");
  await expect(page.getByTestId("admin-imports-heading")).toBeVisible();
  const file = [
    "sku,title_fa,title_en,category,price,status",
    `E2E-A-${id},TEST لنت ${id},TEST pads ${id},${slug},120000,active`,
    `E2E-B-${id},TEST بی‌دسته ${id},,nowhere-${id},1000,`,
  ].join("\r\n");
  await page.getByLabel("CSV file").setInputFiles({ name: `test-${id}.csv`, mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
  await page.getByTestId("admin-import-upload-submit").click();
  await expect(page.getByTestId("form-success")).toBeVisible();
  await page.getByTestId("admin-import-jobs").getByRole("link", { name: `test-${id}.csv` }).click();

  // The page refreshes itself while the file is checked.
  await expect(page.getByTestId("admin-import-status")).toHaveText("Checked", { timeout: 90_000 });
  await expect(page.getByTestId("admin-import-create")).toHaveText("1");
  await expect(page.getByTestId("admin-import-invalid")).toHaveText("1");
  await expect(page.getByTestId("admin-import-problem")).toContainText("no category has this address");

  await page.getByTestId("admin-import-confirm-submit").click();
  await expect(page.getByTestId("admin-import-status")).toHaveText("Done", { timeout: 90_000 });
  await expect(page.getByTestId("admin-import-applied")).toHaveText("1");
  const [product] = await sql<{ price: string; status: string }>(
    "SELECT v.price::text, p.status::text FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $1",
    [`E2E-A-${id}`],
  );
  expect(product).toEqual({ price: "1200000", status: "active" });
});
