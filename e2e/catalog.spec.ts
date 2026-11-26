import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Phase 6 catalog end to end: a Business Admin builds a category, a brand
 * and a product, prices and publishes it; a Store Staff member limited to
 * one category proposes a price and a Business Admin approves it. All data
 * is synthetic (E2E ... / test-e2e-*), created here.
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

async function createAdmin(roleKey: "business_admin" | "store_staff", scopeCategoryId?: string): Promise<string> {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Catalog') RETURNING id", [username]);
  await sql("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [
    user!.id,
    user!.id,
    await hashPassword(PASSWORD),
  ]);
  const [ur] = await sql<{ id: string }>("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2 RETURNING id", [user!.id, roleKey]);
  if (scopeCategoryId) {
    await sql("INSERT INTO user_role_scopes (user_role_id, scope_type, category_id) VALUES ($1, 'category', $2)", [ur!.id, scopeCategoryId]);
  }
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

/** A category and a priced draft product in it, inserted directly. */
async function fixture(): Promise<{ categoryId: string; productId: string; title: string }> {
  const id = randomUUID().slice(0, 8);
  const [category] = await sql<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id");
  await sql("INSERT INTO category_translations (category_id, locale, name, slug, search_name) VALUES ($1, 'fa', $2::text, $3, $2::text)", [
    category!.id,
    `e2e دسته ${id}`,
    `e2e-cat-${id}`,
  ]);
  const title = `E2E filter ${id}`;
  const [product] = await sql<{ id: string }>("INSERT INTO products (primary_category_id) VALUES ($1) RETURNING id", [category!.id]);
  await sql("INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)", [product!.id, category!.id]);
  await sql("INSERT INTO product_translations (product_id, locale, title, slug, search_title) VALUES ($1, 'fa', $2::text, $3, lower($2::text))", [
    product!.id,
    title,
    `e2e-product-${id}`,
  ]);
  await sql("INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price) VALUES ($1, $2, $3, true, 1000000)", [
    product!.id,
    `E2E-${id}`,
    `E2E${id.toUpperCase()}`,
  ]);
  return { categoryId: category!.id, productId: product!.id, title };
}

test.describe("catalog", () => {
  test("a Business Admin creates a category, a brand and a product, prices and publishes it", async ({ page }) => {
    test.setTimeout(90_000);
    const id = randomUUID().slice(0, 8);
    await signInAndEnrol(page, await createAdmin("business_admin"));

    await page.goto("/en/admin/categories");
    const category = `E2E Brakes ${id}`;
    await page.locator("#faName").fill(`ترمز ${id}`);
    await page.locator("#enName").fill(category);
    await page.getByTestId("admin-category-create-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("Category added");
    await expect(page.getByTestId("admin-categories-list")).toContainText(category);

    await page.goto("/en/admin/brands");
    await page.locator("#faName").fill(`برند ${id}`);
    await page.locator("#enName").fill(`E2E Brand ${id}`);
    await page.getByTestId("admin-brand-create-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("Brand added");

    await page.goto("/en/admin/products");
    await page.getByTestId("admin-product-new-link").click();
    await page.locator("#faTitle").fill(`لنت ترمز ${id}`);
    await page.locator("#enTitle").fill(`E2E Brake pads ${id}`);
    await page.locator("#primaryCategoryId").selectOption({ label: category });
    await page.locator("#brandId").selectOption({ label: `E2E Brand ${id}` });
    await page.locator("#sku").fill(`e2e-${id}`);
    await page.locator("#price").fill("125,000");
    await page.getByTestId("admin-product-create-submit").click();
    await expect(page).toHaveURL(/\/en\/admin\/products\/[0-9a-f-]{36}\?created=productCreated$/);
    await expect(page.getByTestId("admin-product-created")).toBeVisible();
    await expect(page.getByTestId("admin-variant-price")).toHaveText("125,000 Toman");
    await expect(page.getByTestId("admin-product-status")).toHaveText("Draft");

    await page.getByTestId("admin-product-status-active-submit").click();
    await expect(page.getByTestId("admin-product-status")).toHaveText("Published");

    await page.locator("#identifierValue").fill(`${id}-KZ ۰۱`);
    await page.getByTestId("admin-identifier-add-submit").click();
    await expect(page.getByTestId("admin-identifier-row")).toContainText(`${id}-KZ 01`);

    // A photo: uploaded, shown resized, made the main one by default, then removed.
    await expect(page.getByTestId("admin-images-empty")).toBeVisible();
    const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#e85d1a" } }).jpeg().toBuffer();
    await page.getByTestId("admin-image-add").locator('input[type="file"]').setInputFiles({ name: "pads.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.getByTestId("admin-image-add-submit").click();
    await expect(page.getByTestId("admin-image-row")).toHaveCount(1);
    await expect(page.getByTestId("admin-image-primary")).toBeVisible();
    const img = page.getByTestId("admin-image-row").locator("img");
    await expect(img).toHaveAttribute("alt", `E2E Brake pads ${id}`);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    const src = (await img.getAttribute("src"))!;
    const served = await page.request.get(src);
    expect(served.headers()["content-type"]).toBe("image/webp");
    await page.getByTestId("admin-image-remove-submit").click();
    await expect(page.getByTestId("admin-images-empty")).toBeVisible();
    expect((await page.request.get(src)).status()).toBe(404);

    // Found by part number whatever the separators.
    await page.goto(`/en/admin/products?q=${id}kz01`);
    await expect(page.getByTestId("admin-product-row")).toContainText(`E2E Brake pads ${id}`);
  });

  test("Store Staff propose a price in their category; a Business Admin approves it", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const { categoryId, productId, title } = await fixture();
    const other = await fixture();

    await signInAndEnrol(page, await createAdmin("store_staff", categoryId));
    await page.goto("/en/admin/products");
    await expect(page.getByTestId("admin-products-table")).toContainText(title);
    await expect(page.getByTestId("admin-products-table")).not.toContainText(other.title);
    const denied = await page.goto(`/en/admin/products/${other.productId}`);
    expect(denied?.status()).toBe(403);

    await page.goto(`/en/admin/products/${productId}`);
    await expect(page.getByTestId("admin-variant-price-form-submit")).toHaveText("Send for approval");
    await page.getByTestId("admin-variant-price-form").getByLabel(/^Price \(/).fill("120000");
    await page.getByTestId("admin-variant-price-form-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("sent for approval");
    await expect(page.getByTestId("admin-variant-pending")).toBeVisible();
    await expect(page.getByTestId("admin-variant-price")).toHaveText("100,000 Toman");

    const manager = await browser.newPage();
    await signInAndEnrol(manager, await createAdmin("business_admin"));
    await manager.goto("/en/admin/approvals");
    const row = manager.getByTestId("approval-row").filter({ hasText: title });
    await expect(row).toContainText("100,000 Toman → 120,000 Toman");
    await row.getByTestId("approval-approve-submit").click();
    // The request leaves the waiting list and shows as applied among decided ones.
    await expect(row).toHaveCount(0);
    await manager.goto("/en/admin/approvals?view=decided");
    await expect(manager.getByTestId("approval-row").filter({ hasText: title })).toContainText("Applied");
    await manager.context().close();

    await page.goto(`/en/admin/products/${productId}`);
    await expect(page.getByTestId("admin-variant-price")).toHaveText("120,000 Toman");
    await page.goto("/en/admin/approvals");
    await expect(page.getByTestId("approval-mine-row").filter({ hasText: title })).toContainText("Applied");
  });
});
