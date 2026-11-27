import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Phase 6 part 2c end to end: a Business Admin creates a warehouse, receives
 * stock of a product on its screen, is refused issuing more than there is,
 * and finds the stock on the inventory screen. All data is synthetic.
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
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Inventory') RETURNING id", [username]);
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
  await sql("INSERT INTO category_translations (category_id, locale, name, slug, search_name) VALUES ($1, 'fa', $2::text, $3, $2::text)", [category!.id, `e2e دسته ${id}`, `e2e-inv-cat-${id}`]);
  const [product] = await sql<{ id: string }>("INSERT INTO products (primary_category_id) VALUES ($1) RETURNING id", [category!.id]);
  await sql("INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)", [product!.id, category!.id]);
  await sql("INSERT INTO product_translations (product_id, locale, title, slug, search_title) VALUES ($1, 'fa', $2::text, $3, lower($2::text))", [product!.id, `E2E stock ${id}`, `e2e-inv-product-${id}`]);
  await sql("INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price) VALUES ($1, $2, $3, true, 1000000)", [product!.id, `E2EI-${id}`, `E2EI${id.toUpperCase()}`]);
  return product!.id;
}

test("a Business Admin creates a warehouse and records stock on a product", async ({ page }) => {
  test.setTimeout(120_000);
  const id = randomUUID().slice(0, 8);
  const code = `E2E-${id.toUpperCase()}`;
  await signInAndEnrol(page, await createBusinessAdmin());
  const productId = await draftProduct(id);

  await page.goto("/en/admin/warehouses");
  const create = page.getByTestId("admin-warehouse-create");
  await create.getByLabel("Code").fill(code.toLowerCase());
  await create.getByLabel("Name").fill(`E2E warehouse ${id}`);
  await page.getByTestId("admin-warehouse-create-submit").click();
  await expect(create.getByTestId("form-success")).toBeVisible();
  await expect(page.getByTestId("admin-warehouses-list")).toContainText(code);

  await page.goto(`/en/admin/products/${productId}`);
  const card = page.getByTestId("admin-product-stock");
  await expect(card.getByTestId("admin-stock-empty")).toBeVisible();
  const form = page.getByTestId("admin-stock-movement");
  await form.getByLabel("Movement").selectOption("receive");
  await form.getByLabel("Warehouse / location").selectOption({ label: `${code} / MAIN` });
  await form.getByLabel("Quantity").fill("7");
  await form.getByLabel("Document number").fill(`INV-${id}`);
  await page.getByTestId("admin-stock-movement-submit").click();
  await expect(form.getByTestId("form-success")).toBeVisible();
  const row = card.getByTestId("admin-stock-row").filter({ hasText: code });
  await expect(row.getByTestId("admin-stock-on-hand")).toHaveText("7");

  await form.getByLabel("Movement").selectOption("issue");
  await form.getByLabel("Warehouse / location").selectOption({ label: `${code} / MAIN` });
  await form.getByLabel("Quantity").fill("9");
  await form.getByLabel("Note").fill("E2E too many");
  await page.getByTestId("admin-stock-movement-submit").click();
  await expect(form.getByTestId("form-error")).toContainText("Not enough stock");
  await expect(row.getByTestId("admin-stock-on-hand")).toHaveText("7");

  await page.goto(`/en/admin/inventory?sku=E2EI-${id}`);
  await expect(page.getByTestId("admin-inventory-row")).toHaveCount(1);
  await expect(page.getByTestId("admin-inventory-row")).toContainText(`${code} / MAIN`);
});

async function warehouseWithStock(id: string, suffix: string, variantSku: string | null, quantity: number) {
  const [w] = await sql<{ id: string }>("INSERT INTO warehouses (code, name) VALUES ($1, $2) RETURNING id", [`E2E${suffix}-${id.toUpperCase()}`, `E2E ${suffix} ${id}`]);
  const [l] = await sql<{ id: string }>("INSERT INTO warehouse_locations (warehouse_id, code, is_default) VALUES ($1, 'MAIN', true) RETURNING id", [w!.id]);
  if (variantSku) {
    await sql(
      "INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type) SELECT id, $2, $3, 'receipt', $4, 'manual' FROM product_variants WHERE sku = $1",
      [variantSku, l!.id, w!.id, quantity],
    );
  }
  return { code: `E2E${suffix}-${id.toUpperCase()}`, warehouseId: w!.id, locationId: l!.id };
}

const stockAt = async (sku: string, locationId: string) =>
  (await sql<{ on_hand: number }>("SELECT b.on_hand FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id WHERE v.sku = $1 AND b.location_id = $2", [sku, locationId]))[0]?.on_hand ?? 0;

test("a Business Admin moves stock between warehouses and counts a warehouse", async ({ page }) => {
  test.setTimeout(120_000);
  const id = randomUUID().slice(0, 8);
  const sku = `E2EI-${id}`;
  await signInAndEnrol(page, await createBusinessAdmin());
  await draftProduct(id);
  const a = await warehouseWithStock(id, "A", sku, 10);
  const b = await warehouseWithStock(id, "B", null, 0);

  await page.goto("/en/admin/inventory");
  await page.getByTestId("admin-inventory-transfers").click();
  const create = page.getByTestId("admin-transfer-new");
  await create.getByLabel("From warehouse").selectOption({ label: `${a.code} · E2E A ${id}` });
  await create.getByLabel("To warehouse").selectOption({ label: `${b.code} · E2E B ${id}` });
  await page.getByTestId("admin-transfer-new-submit").click();
  await expect(page.getByTestId("admin-transfer-heading")).toBeVisible();
  const add = page.getByTestId("admin-transfer-add");
  await add.getByLabel("SKU").fill(sku.toLowerCase());
  await add.getByLabel("Quantity").fill("4");
  await page.getByTestId("admin-transfer-add-submit").click();
  await expect(page.getByTestId("admin-transfer-line")).toHaveCount(1);
  await page.getByTestId("admin-transfer-ship-submit").click();
  await expect(page.getByTestId("admin-transfer-status")).toHaveText("On the way");
  expect(await stockAt(sku, a.locationId)).toBe(6);
  await page.getByTestId("admin-transfer-receive-submit").click();
  await expect(page.getByTestId("admin-transfer-status")).toHaveText("Received");
  expect(await stockAt(sku, b.locationId)).toBe(4);

  await page.goto("/en/admin/inventory/counts");
  await page.getByTestId("admin-count-new").getByLabel("What to count").selectOption({ label: `${a.code} · E2E A ${id} (whole warehouse)` });
  await page.getByTestId("admin-count-new-submit").click();
  await expect(page.getByTestId("admin-count-heading")).toBeVisible();
  await expect(page.getByTestId("admin-count-line")).toHaveCount(1);
  await page.getByLabel(`Counted quantity for ${sku}`).fill("5");
  await page.getByTestId("admin-count-form-submit").click();
  await expect(page.getByTestId("admin-count-form").getByTestId("form-success")).toBeVisible();
  await page.getByTestId("admin-count-complete-submit").click();
  await expect(page.getByTestId("admin-count-status")).toHaveText("Completed");
  expect(await stockAt(sku, a.locationId)).toBe(5);
});
