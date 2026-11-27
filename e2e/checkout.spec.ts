import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Phase 6b part 3 end to end: a Business Admin sets up delivery (a zone, a
 * method and its price), then a signed-in customer orders a part: cart,
 * checkout with an address, delivery priced for the province, and the order
 * page. A guest is sent to sign in first. All data is synthetic.
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
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Shipping') RETURNING id", [username]);
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

/** A published part with 5 in stock and a weight of 800 g. */
async function stockedPart(id: string) {
  const [category] = await sql<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id");
  const [p] = await sql<{ id: string }>("INSERT INTO products (primary_category_id, status, published_at) VALUES ($1, 'active', now()) RETURNING id", [category!.id]);
  await sql("INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)", [p!.id, category!.id]);
  await sql("INSERT INTO product_translations (product_id, locale, title, slug, search_title) VALUES ($1, 'en', $2::text, $3, lower($2::text))", [p!.id, `E2E Clutch ${id}`, `e2e-clutch-${id}`]);
  const [v] = await sql<{ id: string }>("INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price, weight_grams) VALUES ($1, $2, $3, true, 500000, 800) RETURNING id", [p!.id, `E2EK-${id}`, `E2EK${id.toUpperCase()}`]);
  const [w] = await sql<{ id: string }>("INSERT INTO warehouses (code, name) VALUES ($1, 'E2E') RETURNING id", [`E2EK-${id.toUpperCase()}`]);
  const [l] = await sql<{ id: string }>("INSERT INTO warehouse_locations (warehouse_id, code, is_default) VALUES ($1, 'MAIN', true) RETURNING id", [w!.id]);
  await sql("INSERT INTO inventory_movements (variant_id, location_id, warehouse_id, type, quantity, reference_type) VALUES ($1, $2, $3, 'receipt', 5, 'manual')", [v!.id, l!.id, w!.id]);
  return { slug: `e2e-clutch-${id}`, variantId: v!.id };
}

/** The test-only gateway on, as a Super Admin would switch it on under Admin › Payments. */
async function fakeGatewayOn() {
  await sql(
    `INSERT INTO payment_providers (code, adapter_key, credentials_env_prefix, is_sandbox, is_active) VALUES ('fake', 'fake', 'FAKE', true, true)
     ON CONFLICT (code) DO UPDATE SET is_active = true, config = '{}'`,
  );
}

/** Signs a new customer in by giving the browser a session, as the SMS sign-in would. */
async function signInCustomer(page: Page): Promise<string> {
  const phone = `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [phone]);
  const token = randomBytes(32).toString("base64url");
  await sql("INSERT INTO sessions (user_id, token_hash, kind, expires_at) VALUES ($1, $2, 'customer', now() + interval '1 day')", [user!.id, createHash("sha256").update(token).digest("hex")]);
  // A Secure cookie can't be added for an http:// URL; the browser still sends
  // it to http://127.0.0.1, which counts as a secure origin.
  const origin = new URL(test.info().project.use.baseURL!).origin.replace(/^http:/, "https:");
  await page.context().addCookies([{ name: "__Host-clicksp_session", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Lax" }]);
  return phone;
}

test("a Business Admin sets up delivery and a customer places an order", async ({ page }) => {
  test.setTimeout(120_000);
  const id = randomUUID().slice(0, 8);
  const { slug } = await stockedPart(id);
  await fakeGatewayOn();

  await signInBusinessAdmin(page);
  await page.goto("/en/admin/shipping");
  const zone = page.getByTestId("admin-shipping-zone-create");
  await zone.getByLabel("Code").fill(`e2e_${id}`);
  await zone.getByLabel("Persian name").fill(`E2E اصفهان ${id}`);
  await zone.getByLabel("Isfahan").check();
  await zone.getByTestId("admin-shipping-zone-create-submit").click();
  await expect(zone.getByText("Created.")).toBeVisible();

  const method = page.getByTestId("admin-shipping-method-create");
  await method.getByLabel("Code").fill(`e2e_post_${id}`);
  await method.getByLabel("Persian name").fill(`E2E پست ${id}`);
  await method.getByLabel("English name").fill(`E2E Post ${id}`);
  await method.getByTestId("admin-shipping-method-create-submit").click();
  await expect(method.getByText("Created.")).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: new RegExp(`E2E Post ${id}`) }).click();
  const rate = page.getByTestId("admin-shipping-rate-add");
  await rate.getByLabel("Zone").selectOption({ label: `E2E اصفهان ${id}` });
  await rate.getByLabel("Base price").fill("30000");
  await rate.getByLabel("Per kg").fill("10000");
  await rate.getByTestId("admin-shipping-rate-add-submit").click();
  await expect(rate.getByText("Created.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("admin-shipping-rate-row")).toHaveCount(1);

  // The customer, in a fresh browser session.
  await page.context().clearCookies();
  await signInCustomer(page);
  await page.goto(`/en/p/${slug}`);
  await page.getByTestId("add-to-cart-quantity").fill("2");
  await page.getByTestId("add-to-cart-submit").click();
  await expect(page.getByTestId("add-to-cart-done")).toBeVisible();
  await page.goto("/en/cart");
  await page.getByTestId("cart-checkout").click();
  await expect(page.getByTestId("checkout-heading")).toBeVisible();
  await expect(page.getByTestId("checkout-goods-total")).toHaveText("100,000 Toman");

  const form = page.getByTestId("checkout-form");
  await form.getByLabel("Recipient's name").fill("E2E Rider");
  await form.getByLabel("City").fill("Isfahan");
  await form.getByLabel("Address", { exact: true }).fill("E2E test street 1");
  await form.getByLabel("Postal code (10 digits)").fill("8134567890");
  await page.getByTestId("checkout-province").selectOption({ label: "Tehran" });
  await expect(page.getByTestId("checkout-shipping-option").filter({ hasText: `E2E Post ${id}` })).toHaveCount(0);
  await page.getByTestId("checkout-province").selectOption({ label: "Isfahan" });
  const option = page.getByTestId("checkout-shipping-option").filter({ hasText: `E2E Post ${id}` });
  // 1,600 g: 30,000 + 2 × 10,000 Toman.
  await expect(option).toContainText("50,000 Toman");
  await option.getByRole("radio").check();
  await page.getByTestId("checkout-submit").click();

  await expect(page).toHaveURL(/\/en\/account\/orders\/\d+$/);
  const orderUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("order-status")).toHaveText("Awaiting payment");
  await expect(page.getByTestId("order-total")).toHaveText("150,000 Toman");
  await expect(page.getByTestId("order-address")).toContainText("8134567890");
  await expect(page.getByTestId("header-cart-count")).toHaveCount(0);

  await page.goto("/en/account");
  await expect(page.getByTestId("account-order-row")).toHaveCount(1);
  // The address was saved at checkout; the customer can name themselves and remove it.
  await expect(page.getByTestId("account-address")).toHaveCount(1);
  await expect(page.getByTestId("account-address")).toContainText("E2E test street 1");
  await page.getByTestId("account-name").getByLabel("Your name").fill("E2E Rider");
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/en/account"));
  await page.getByTestId("account-name").getByRole("button", { name: "Save" }).click();
  await saved;
  await page.reload();
  await expect(page.getByTestId("account-name").getByLabel("Your name")).toHaveValue("E2E Rider");
  await page.getByTestId("account-address-remove").click();
  await expect(page.getByTestId("account-address")).toHaveCount(0);

  // Paying online: the (test) bank sends the customer back, and the order is paid.
  await page.goto(orderUrl);
  await page.getByTestId("order-pay-submit").click();
  await expect(page.getByTestId("order-status")).toHaveText("Paid");
  await expect(page).toHaveURL(new RegExp(`${orderUrl}$`));
  await expect(page.getByTestId("order-paid-reference")).toContainText("FAKE");
  await expect(page.getByTestId("order-pay")).toHaveCount(0);
});

test("a guest is asked to sign in before checkout", async ({ page }) => {
  await page.goto("/en/checkout");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fcheckout|\/en\/login\?next=\/checkout/);
  await expect(page.getByTestId("customer-login-heading")).toBeVisible();
});
