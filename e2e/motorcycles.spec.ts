import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Phase 6 part 2b end to end: a Business Admin enters a motorcycle (maker,
 * brand, model, model years, engine version), links a product to it with a
 * source, and verifies the link. All data is synthetic (E2E ... / test-e2e-*).
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

async function createBusinessAdmin(): Promise<string> {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Motorcycles') RETURNING id", [username]);
  await sql("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [user!.id, user!.id, await hashPassword(PASSWORD)]);
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'business_admin'", [user!.id]);
  return username;
}

async function signInAndEnrol(page: Page, username: string) {
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

async function draftProduct(id: string): Promise<string> {
  const [category] = await sql<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id");
  await sql("INSERT INTO category_translations (category_id, locale, name, slug, search_name) VALUES ($1, 'fa', $2::text, $3, $2::text)", [category!.id, `e2e دسته ${id}`, `e2e-moto-cat-${id}`]);
  const [product] = await sql<{ id: string }>("INSERT INTO products (primary_category_id) VALUES ($1) RETURNING id", [category!.id]);
  await sql("INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)", [product!.id, category!.id]);
  await sql("INSERT INTO product_translations (product_id, locale, title, slug, search_title) VALUES ($1, 'fa', $2::text, $3, lower($2::text))", [product!.id, `E2E chain ${id}`, `e2e-moto-product-${id}`]);
  await sql("INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price) VALUES ($1, $2, $3, true, 1000000)", [product!.id, `E2EM-${id}`, `E2EM${id.toUpperCase()}`]);
  return product!.id;
}

test("a Business Admin enters a motorcycle and links a part to it, then verifies the link", async ({ page }) => {
  test.setTimeout(120_000);
  const id = randomUUID().slice(0, 8);
  await signInAndEnrol(page, await createBusinessAdmin());

  await page.goto("/en/admin/motorcycles");
  await page.locator("#m-faName").fill(`سازنده ${id}`);
  await page.locator("#m-enName").fill(`E2E Maker ${id}`);
  await page.locator("#countryCode").fill("ir");
  await page.getByTestId("admin-manufacturer-create-submit").click();
  await expect(page.getByTestId("form-success")).toContainText("Added");
  await expect(page.getByTestId("admin-motorcycles-list")).toContainText(`E2E Maker ${id}`);

  await page.locator("#manufacturerId").selectOption({ label: `E2E Maker ${id}` });
  await page.locator("#b-faName").fill(`برند ${id}`);
  await page.locator("#b-enName").fill(`E2E Moto ${id}`);
  await page.getByTestId("admin-motorcycle-brand-create-submit").click();
  await page.getByTestId("admin-motorcycle-brand-row").filter({ hasText: `E2E Moto ${id}` }).click();

  await page.locator("#new-faName").fill(`مدل ${id}`);
  await page.locator("#new-enName").fill(`Rider ${id}`);
  await page.locator("#new-segment").selectOption("standard");
  await page.getByTestId("admin-model-create-submit").click();
  await page.getByTestId("admin-model-row").filter({ hasText: `Rider ${id}` }).click();
  await expect(page.getByTestId("admin-generations-empty")).toBeVisible();

  // Solar model years 1390–1398 are stored as 2011–2019.
  await page.locator("#new-gen-yearFrom").fill("1390");
  await page.locator("#new-gen-yearTo").fill("1398");
  await page.getByTestId("admin-generation-create-submit").click();
  await expect(page.getByTestId("admin-generation-row")).toContainText("2011–2019");

  await page.locator("#new-var-faName").fill("۱۲۵ کاربراتوری");
  await page.locator("#new-var-enName").fill("125 carb");
  await page.locator("#new-var-cc").fill("125");
  await page.locator("#new-var-fuelSystem").selectOption("carburetor");
  await page.getByTestId("admin-motorcycle-variant-create-submit").click();
  await expect(page.getByTestId("admin-motorcycle-variant-row")).toContainText("125 carb");

  const productId = await draftProduct(id);
  await page.goto(`/en/admin/products/${productId}`);
  await expect(page.getByTestId("admin-fitment-empty")).toBeVisible();
  const form = page.getByTestId("admin-fitment-add");
  // The engine version of this run's model (other runs may have the same label).
  const option = form.locator(`#fitTarget optgroup[label="E2E Moto ${id} Rider ${id}"] option`).filter({ hasText: "125 carb" });
  await form.locator("#fitTarget").selectOption((await option.getAttribute("value"))!);
  await form.locator("#fitPosition").selectOption("rear");
  await form.locator("#fitSourceTitle").fill("E2E parts catalogue");
  await form.locator("#fitSourceReference").fill("p. 42");
  await page.getByTestId("admin-fitment-add-submit").click();
  const row = page.getByTestId("admin-fitment-row");
  await expect(row).toContainText(`E2E Moto ${id} Rider ${id}`);
  await expect(row).toContainText("Rear");
  await expect(page.getByTestId("admin-fitment-status")).toHaveText("Unverified");

  await page.getByTestId("admin-fitment-verified-submit").click();
  await expect(page.getByTestId("admin-fitment-status")).toHaveText("Verified");
  await expect(row).toContainText("Verified by E2E Motorcycles");
});
