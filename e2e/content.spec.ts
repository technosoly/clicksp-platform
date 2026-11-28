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
  const { key, name } = info.project.name === "mobile" ? { key: "shipping", name: "Shipping and delivery" } : { key: "returns", name: "Returns" };
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

test("a Business Admin sets the contact details and visitors see them on the Contact page", async ({ page }, info) => {
  // One project writes the shared store setting, so the two projects can't overwrite each other.
  test.skip(info.project.name === "mobile", "the setting is shared; the desktop project writes it");
  const id = randomUUID().slice(0, 8);
  await signInBusinessAdmin(page);
  await page.goto("/en/admin/content");
  await page.getByTestId("admin-contact-edit").click();
  await expect(page.getByTestId("admin-contact-heading")).toContainText("Contact details");
  await page.getByLabel("Address (Persian)").fill(`TEST نشانی ${id}`);
  await page.getByLabel("Phone 1").fill("021-0000 0000");
  await page.getByLabel("Opening hours (Persian)").fill("TEST شنبه تا پنجشنبه");
  await page.getByLabel("Neshan link (neshan.org or nshn.ir)").fill("https://evil.test/x");
  await page.getByTestId("admin-contact-form-submit").click();
  await expect(page.getByTestId("form-error")).toContainText("neshan.org");
  await page.getByLabel("Neshan link (neshan.org or nshn.ir)").fill("https://nshn.ir/TEST");
  await page.getByLabel("Google embedded map code (optional)").fill('<iframe src="https://www.google.com/maps/embed?pb=TEST"></iframe>');
  await page.getByTestId("admin-contact-form-submit").click();
  await expect(page.getByTestId("form-success")).toContainText("Saved");

  await page.goto("/fa");
  await page.getByTestId("footer-contact").click();
  await expect(page).toHaveURL(/\/fa\/contact$/);
  await expect(page.getByTestId("contact-address")).toContainText(`TEST نشانی ${id}`);
  await expect(page.getByTestId("contact-phone")).toHaveText("۰۲۱۰۰۰۰۰۰۰۰");
  await expect(page.getByTestId("contact-phone")).toHaveAttribute("href", "tel:02100000000");
  await expect(page.getByTestId("contact-map-neshan")).toHaveAttribute("href", "https://nshn.ir/TEST");
  // The Google map is not loaded until the visitor asks for it.
  await expect(page.getByTestId("contact-map-frame")).toHaveCount(0);
  await page.getByTestId("contact-map-load").click();
  await expect(page.getByTestId("contact-map-frame")).toHaveAttribute("src", "https://www.google.com/maps/embed?pb=TEST");
  // The old address of the information page leads here.
  await page.goto("/en/pages/contact");
  await expect(page).toHaveURL(/\/en\/contact$/);
});

test("the About page shows the store's story and links to Contact", async ({ page }) => {
  await page.goto("/fa");
  await page.getByTestId("footer-about").click();
  await expect(page).toHaveURL(/\/fa\/about$/);
  await expect(page.getByTestId("about-heading")).toBeVisible();
  await expect(page.getByTestId("about-values").getByRole("heading")).toHaveCount(4);
  await expect(page.getByTestId("about-story")).not.toBeEmpty();
  await expect(page).toHaveTitle(/دربارهٔ ما/);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/fa\/about$/);
  await page.getByTestId("about-contact-link").click();
  await expect(page).toHaveURL(/\/fa\/contact$/);
  await expect(page.getByTestId("contact-heading")).toBeVisible();
});
