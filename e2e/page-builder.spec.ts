import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Page builder end to end: the Super Admin adds a section to the home page,
 * previews the draft, publishes it, and visitors see it; then removes it
 * again. A Business Admin can't open the builder or the preview.
 * Text is synthetic and marked TEST.
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

async function signIn(page: Page, role: "super_admin" | "business_admin") {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Builder') RETURNING id", [username]);
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

test("the Super Admin adds, previews and publishes a home page section", async ({ page, browser }, testInfo) => {
  // Both projects share the one home page; the desktop run covers it.
  test.skip(testInfo.project.name !== "desktop", "one editor at a time");
  test.setTimeout(150_000);
  const id = randomUUID().slice(0, 8);
  await signIn(page, "super_admin");

  await page.goto("/en/admin/page-builder");
  await expect(page.getByTestId("admin-builder-heading")).toBeVisible();
  await page.getByTestId("admin-builder-add").getByLabel("Section type").selectOption("callout");
  await page.getByTestId("admin-builder-add-submit").click();
  await expect(page.getByTestId("admin-builder-add").getByTestId("form-success")).toBeVisible();
  await expect(page.getByTestId("admin-builder-source")).toHaveText("Editing a draft");

  const section = page.getByTestId("admin-builder-section-callout").last();
  await section.locator("summary").click();
  await section.locator('input[name="title.fa"]').fill(`TEST پیشنهاد ${id}`);
  await section.locator('input[name="title.en"]').fill(`TEST offer ${id}`);
  await section.locator('textarea[name="text.en"]').fill("<script>alert(1)</script>");
  await section.locator('textarea[name="text.fa"]').fill("متن");
  await section.locator('input[name="cta.fa"]').fill("ببینید");
  await section.locator('input[name="cta.en"]').fill("See motorcycles");
  await section.locator('input[name="href"]').fill("javascript:alert(1)");
  await section.getByRole("button", { name: "Save section" }).click();
  await expect(section.getByTestId("form-error")).toContainText("https://");
  await section.locator('input[name="href"]').fill("/motorcycles");
  await section.getByRole("button", { name: "Save section" }).click();
  await expect(section.getByTestId("form-success")).toBeVisible();

  // Visitors don't see the draft; the preview does.
  const visitor = await browser.newPage();
  await visitor.goto("/en");
  await expect(visitor.getByText(`TEST offer ${id}`)).toHaveCount(0);
  await page.goto("/en/preview/home");
  await expect(page.getByTestId("builder-preview-notice")).toBeVisible();
  await expect(page.getByTestId("builder-callout").filter({ hasText: `TEST offer ${id}` })).toBeVisible();

  await page.goto("/en/admin/page-builder");
  await page.getByTestId("admin-builder-publish").getByLabel("Note (optional)").fill(`TEST ${id}`);
  await page.getByTestId("admin-builder-publish-submit").click();
  await expect(page.getByTestId("admin-builder-source")).toHaveText("Showing the published page");

  await visitor.goto("/en");
  const callout = visitor.getByTestId("builder-callout").filter({ hasText: `TEST offer ${id}` });
  await expect(callout).toBeVisible();
  // Typed markup stays text.
  await expect(callout).toContainText("<script>alert(1)</script>");
  await callout.getByRole("link", { name: "See motorcycles" }).click();
  await expect(visitor).toHaveURL(/\/en\/motorcycles$/);
  await visitor.goto("/fa");
  await expect(visitor.getByTestId("builder-callout").filter({ hasText: `TEST پیشنهاد ${id}` })).toBeVisible();
  await expect(visitor.getByTestId("home-heading")).toBeVisible();

  // Clean up: remove the section and publish again.
  await page.goto("/en/admin/page-builder");
  const mine = page.getByTestId("admin-builder-section-callout").filter({ has: page.locator(`input[value="TEST offer ${id}"]`) });
  await mine.locator("summary").click();
  await mine.getByLabel("Yes, remove this section").check();
  await mine.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("admin-builder-source")).toHaveText("Editing a draft");
  await page.getByTestId("admin-builder-publish-submit").click();
  await expect(page.getByTestId("admin-builder-source")).toHaveText("Showing the published page");
  await visitor.goto("/en");
  await expect(visitor.getByText(`TEST offer ${id}`)).toHaveCount(0);
  await visitor.close();
});

test("a Business Admin can't open the page builder or its preview; a visitor is sent to sign in", async ({ page, browser }) => {
  const visitor = await browser.newPage();
  await visitor.goto("/en/preview/home");
  await expect(visitor).toHaveURL(/\/en\/admin\/login$/);
  await expect(visitor.getByTestId("builder-preview-notice")).toHaveCount(0);
  await visitor.close();
  await signIn(page, "business_admin");
  await expect(page.getByRole("link", { name: "Page builder" })).toHaveCount(0);
  for (const path of ["/en/admin/page-builder", "/en/preview/home"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
  }
});
