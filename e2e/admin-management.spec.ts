import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Phase 5 admin panel end to end: per-level navigation, 403 on typed URLs,
 * creating a Store Staff account and setting its password from the one-time
 * link, the role editor, step-up two-factor for sensitive actions, own
 * password change, and the Content-Security-Policy. Every account is a
 * synthetic test-e2e-* user created here.
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

async function createAdmin(roleKey: "super_admin" | "business_admin" | "store_staff"): Promise<string> {
  const username = `test-e2e-${randomUUID().slice(0, 8)}`;
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Admin') RETURNING id", [username]);
  await sql("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [
    user!.id,
    user!.id,
    await hashPassword(PASSWORD),
  ]);
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2", [user!.id, roleKey]);
  return username;
}

async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("admin-login-submit").click();
}

/** Signs in for the first time and enrols TOTP; returns the secret. */
async function signInAndEnrol(page: Page, username: string, password = PASSWORD): Promise<string> {
  await signIn(page, username, password);
  await expect(page).toHaveURL(/\/en\/admin\/mfa\/setup$/);
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Code from the app").fill(totp(secret, Date.now()));
  await page.getByTestId("admin-mfa-setup-submit").click();
  await page.getByTestId("continue-to-admin").click();
  await expect(page).toHaveURL(/\/en\/admin$/);
  return secret;
}

/** The next TOTP code that hasn't been used yet (codes are single-use per 30 s step). */
async function freshCode(secret: string, usedAt: number): Promise<string> {
  const step = (t: number) => Math.floor(t / 30_000);
  while (step(Date.now()) === step(usedAt)) await new Promise((r) => setTimeout(r, 500));
  return totp(secret, Date.now());
}

async function areas(page: Page): Promise<string[]> {
  await page.goto("/en/admin");
  return page.getByTestId("admin-areas").locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
}

async function expectForbidden(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(403);
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
}

test.describe("admin navigation per level", () => {
  test("Super Admin sees every area, including roles and technical settings", async ({ page }) => {
    await signInAndEnrol(page, await createAdmin("super_admin"));
    const hrefs = await areas(page);
    for (const href of ["/en/admin/people/users", "/en/admin/people/roles", "/en/admin/audit", "/en/admin/system", "/en/admin/page-builder", "/en/admin/accounting"]) {
      expect(hrefs).toContain(href);
    }
    await page.goto("/en/admin/people/roles");
    await expect(page.getByTestId("admin-roles-heading")).toHaveText("Roles and permissions");
    await page.goto("/en/admin/audit?tab=security");
    await expect(page.getByTestId("security-list")).toBeVisible();
  });

  test("Business Admin manages staff but not roles, technical settings or Super Admins", async ({ page }) => {
    await signInAndEnrol(page, await createAdmin("business_admin"));
    const hrefs = await areas(page);
    expect(hrefs).toContain("/en/admin/people/users");
    expect(hrefs).toContain("/en/admin/accounting");
    expect(hrefs).not.toContain("/en/admin/people/roles");
    expect(hrefs).not.toContain("/en/admin/system");
    expect(hrefs).not.toContain("/en/admin/page-builder");
    await expectForbidden(page, "/en/admin/people/roles");
    await expectForbidden(page, "/en/admin/system");
    await expectForbidden(page, "/en/admin/page-builder");

    // Only Store Staff roles can be given; Super Admin accounts are not listed.
    await page.goto("/en/admin/people/users/new");
    const options = await page.locator("#roleId option:not([disabled])").allTextContents();
    expect(options).toEqual(expect.arrayContaining(["Store Staff"]));
    expect(options.join()).not.toMatch(/Super Admin|Business Admin/);
    const [superAdmin] = await sql<{ id: string }>(
      "SELECT ur.user_id AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin' LIMIT 1",
    );
    await expectForbidden(page, `/en/admin/people/users/${superAdmin!.id}`);

    await page.goto("/en/admin/audit");
    await expect(page.getByTestId("admin-audit-heading")).toBeVisible();
    await expect(page.getByText("Changes to business records and staff accounts.")).toBeVisible();
    await expectForbidden(page, "/en/admin/audit?tab=security");
  });
});

test.describe("managing accounts", () => {
  test("a Super Admin creates a Store Staff account; the link sets its password; staff see only their areas", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signInAndEnrol(page, await createAdmin("super_admin"));
    await page.goto("/en/admin/people/users/new");
    const staffName = `test-e2e-staff-${randomUUID().slice(0, 6)}`;
    await page.getByLabel("Name", { exact: true }).fill("E2E Staff");
    await page.getByLabel("Username").fill(staffName);
    await page.locator("#roleId").selectOption({ label: "Store Staff" });
    await page.getByTestId("admin-user-create-submit").click();
    const link = await page.getByTestId("one-time-link-value").inputValue();
    expect(link).toMatch(/\/en\/admin\/set-password#[A-Za-z0-9_-]{43}$/);

    const staffPage = await newPage(browser);
    await staffPage.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    // The token is removed from the address bar once read.
    await expect(staffPage).toHaveURL(/\/en\/admin\/set-password$/);
    await staffPage.getByLabel("New password").fill("staff password 2026");
    await staffPage.getByLabel("Repeat the password").fill("staff password 2026");
    await staffPage.getByTestId("set-password-submit").click();
    await expect(staffPage.getByTestId("set-password-done")).toBeVisible();

    // The link works once.
    const again = await newPage(browser);
    await again.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await again.getByLabel("New password").fill("another password 2026");
    await again.getByLabel("Repeat the password").fill("another password 2026");
    await again.getByTestId("set-password-submit").click();
    await expect(again.getByTestId("form-error")).toContainText("not valid");
    await again.context().close();

    // Store Staff hold a pricing permission (propose), so two-factor is required.
    await signInAndEnrol(staffPage, staffName, "staff password 2026");
    const hrefs = await areas(staffPage);
    expect(hrefs).toContain("/en/admin/products");
    expect(hrefs).toContain("/en/admin/inventory");
    for (const hidden of ["/en/admin/people/users", "/en/admin/people/roles", "/en/admin/accounting", "/en/admin/reports", "/en/admin/audit", "/en/admin/settings"]) {
      expect(hrefs).not.toContain(hidden);
    }
    await expectForbidden(staffPage, "/en/admin/people/users");
    await expectForbidden(staffPage, "/en/admin/accounting");
    await expectForbidden(staffPage, "/en/admin/audit");
    await staffPage.goto("/en/admin/products");
    await expect(staffPage.getByTestId("admin-section-upcoming")).toBeVisible();

    // Back as Super Admin: the account shows up, can be disabled, and is then signed out.
    await page.goto("/en/admin/people/users");
    await page.getByTestId("admin-user-row").filter({ hasText: staffName }).click();
    await page.getByTestId("admin-user-status-form-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("Account disabled");
    await staffPage.goto("/en/admin");
    await expect(staffPage).toHaveURL(/\/en\/admin\/login$/);
    await staffPage.context().close();
  });

  test("sensitive actions ask for a fresh two-factor code after the step-up window", async ({ page }) => {
    test.setTimeout(90_000);
    const username = await createAdmin("super_admin");
    const enrolledAt = Date.now();
    const secret = await signInAndEnrol(page, username);
    const target = await createAdmin("store_staff");
    const [row] = await sql<{ id: string }>("SELECT id FROM users WHERE username = $1", [target]);
    // Pretend the last code was entered 10 minutes ago.
    await sql(
      "UPDATE sessions SET mfa_verified_at = now() - interval '10 minutes' WHERE user_id = (SELECT id FROM users WHERE username = $1) AND revoked_at IS NULL",
      [username],
    );
    await page.goto(`/en/admin/people/users/${row!.id}`);
    await page.getByTestId("admin-user-password-link-submit").click();
    await expect(page.getByTestId("form-mfa-required")).toBeVisible();
    await page.getByTestId("form-mfa-required").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/en/admin/mfa\\?next=`));
    await page.getByLabel("Code").fill(await freshCode(secret, enrolledAt));
    await page.getByTestId("admin-mfa-submit").click();
    await expect(page).toHaveURL(new RegExp(`/en/admin/people/users/${row!.id}$`));
    await page.getByTestId("admin-user-password-link-submit").click();
    await expect(page.getByTestId("one-time-link")).toBeVisible();
  });

  test("an admin changes their own password; the old one stops working", async ({ page }) => {
    const username = await createAdmin("business_admin");
    await signInAndEnrol(page, username);
    await page.goto("/en/admin/account");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill("a brand new password 42");
    await page.getByLabel("Repeat the new password").fill("a brand new password 42");
    await page.getByTestId("admin-change-password-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("Password changed");
    await page.getByTestId("admin-logout").click();
    await signIn(page, username, PASSWORD);
    await expect(page.getByTestId("form-error")).toHaveText("The username or password is incorrect.");
  });

  test("an unknown password link is refused", async ({ page }) => {
    await page.goto(`/fa/admin/set-password#${"x".repeat(43)}`);
    await page.locator("#password").fill("some long password 1");
    await page.locator("#confirm").fill("some long password 1");
    await page.getByTestId("set-password-submit").click();
    await expect(page.getByTestId("form-error")).toBeVisible();
  });
});

test.describe("role editor", () => {
  test("a Super Admin edits the Store Staff bundle; the Super Admin bundle is read-only", async ({ page }) => {
    await signInAndEnrol(page, await createAdmin("super_admin"));
    await page.goto("/en/admin/people/roles");
    await page.getByTestId("admin-role-create").getByLabel("Name", { exact: true }).fill("E2E Warehouse");
    const key = `test_e2e_${randomUUID().slice(0, 6)}`;
    await page.getByTestId("admin-role-create").getByLabel("Key").fill(key);
    await page.getByTestId("admin-role-create-submit").click();
    await expect(page.getByTestId("admin-role-heading")).toHaveText("E2E Warehouse");
    // Level ceiling: a Store Staff level role can never hold role.manage.
    await expect(page.getByTestId("grant-role.manage")).toBeDisabled();
    await page.getByTestId("grant-inventory.view").check();
    await page.getByTestId("admin-role-permissions-submit").click();
    await expect(page.getByTestId("form-success")).toContainText("Permissions saved");
    const rows = await sql("SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.key = $1 AND p.key = 'inventory.view'", [key]);
    expect(rows).toHaveLength(1);

    await page.goto("/en/admin/people/roles");
    await page.getByTestId("admin-role-row").filter({ hasText: "Super Admin" }).click();
    await expect(page.getByTestId("admin-role-readonly")).toBeVisible();
    await expect(page.getByTestId("admin-role-permissions-submit")).toHaveCount(0);
  });
});

test.describe("content security policy", () => {
  test("admin pages get a per-request nonce; the storefront a static policy", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    const first = await page.goto("/en/admin/login");
    const csp = first?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const scripts = await page.locator("script[src]").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const n of scripts) expect(n).toBe(nonce);
    // A second request gets a different nonce.
    const second = await page.goto("/en/admin/login");
    expect(second?.headers()["content-security-policy"]).not.toContain(nonce);
    // Client-side React still runs under the policy: the set-password page reads
    // the URL fragment and removes it (no failed sign-ins here, so the shared
    // local rate-limit bucket is not used up).
    await page.goto("/en/admin/set-password#csp-check-token");
    await expect(page).toHaveURL(/\/en\/admin\/set-password$/);
    expect(violations).toEqual([]);

    const home = await page.goto("/fa");
    const storeCsp = home?.headers()["content-security-policy"] ?? "";
    expect(storeCsp).toContain("object-src 'none'");
    expect(storeCsp).not.toContain("nonce-");
  });
});

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}
