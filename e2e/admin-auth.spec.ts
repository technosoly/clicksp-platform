import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Admin sign-in end to end against the production build. Each test creates
 * its own synthetic Business Admin (test-e2e-...) in the app's database
 * (DATABASE_URL), so it never depends on a real account.
 */
const PASSWORD = "e2e test password 123";

async function createBusinessAdmin(): Promise<string> {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const user = await client.query<{ id: string }>(
      "INSERT INTO users (username, name) VALUES ($1, 'E2E Admin') RETURNING id",
      [username],
    );
    const id = user.rows[0]!.id;
    await client.query(
      "INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)",
      [id, id, await hashPassword(PASSWORD)],
    );
    await client.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'business_admin'", [id]);
  } finally {
    await client.end();
  }
  return username;
}

async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("admin-login-submit").click();
}

test.describe("admin sign-in", () => {
  test("the admin panel sends signed-out visitors to the sign-in page", async ({ page }) => {
    await page.goto("/fa/admin");
    await expect(page).toHaveURL(/\/fa\/admin\/login$/);
    await expect(page.getByTestId("admin-login-heading")).toHaveText("ورود مدیران");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("a wrong password shows one generic error", async ({ page }) => {
    const username = await createBusinessAdmin();
    await signIn(page, username, "not the password");
    await expect(page.getByTestId("form-error")).toHaveText("The username or password is incorrect.");
    await signIn(page, "test-e2e-nobody", "not the password");
    await expect(page.getByTestId("form-error")).toHaveText("The username or password is incorrect.");
  });

  test("first sign-in sets up two-factor, later sign-ins ask for a code, sign-out ends the session", async ({ page, context }) => {
    const username = await createBusinessAdmin();
    await signIn(page, username);

    // Enrolment: read the manual key, answer with a TOTP code.
    await expect(page).toHaveURL(/\/en\/admin\/mfa\/setup$/);
    await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    // Panel is not reachable before enrolment.
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/\/en\/admin\/mfa\/setup$/);
    await page.getByLabel("Code from the app").fill(totp(secret, Date.now()));
    await page.getByTestId("admin-mfa-setup-submit").click();
    const codes = page.getByTestId("backup-codes").locator("li");
    await expect(codes).toHaveCount(10);
    const backupCode = (await codes.first().textContent())!.trim();
    await page.getByTestId("continue-to-admin").click();

    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByTestId("admin-role")).toHaveText("Business Admin");
    await expect(page.getByTestId("admin-mfa-status")).toHaveText("On");
    const cookie = (await context.cookies()).find((c) => c.name === "clicksp_admin");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");

    await page.getByTestId("admin-logout").click();
    await expect(page).toHaveURL(/\/en\/admin\/login$/);
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/\/en\/admin\/login$/);

    // Second sign-in: TOTP challenge, answered with a backup code (the TOTP
    // code of the current 30 s step was already used, and replays are refused).
    await signIn(page, username);
    await expect(page).toHaveURL(/\/en\/admin\/mfa$/);
    await page.getByLabel("Code").fill("000000");
    await page.getByTestId("admin-mfa-submit").click();
    await expect(page.getByTestId("form-error")).toBeVisible();
    await page.getByLabel("Code").fill(backupCode);
    await page.getByTestId("admin-mfa-submit").click();
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByTestId("admin-dashboard-heading")).toHaveText("Welcome, E2E Admin");
  });
});

test.describe("customer sign-in", () => {
  test("shows that phone sign-in is not available without an SMS provider", async ({ page }) => {
    await page.goto("/fa/login");
    await expect(page.getByTestId("customer-login-heading")).toBeVisible();
    await expect(page.getByTestId("phone-login-unavailable")).toBeVisible();
  });

  test("the account page asks signed-out visitors to sign in", async ({ page }) => {
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/login$/);
  });
});
