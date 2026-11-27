import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { hashPassword } from "../src/lib/security/password";
import { totp } from "../src/lib/security/totp";

/**
 * Accounting end to end: a Business Admin creates two accounts, opens a
 * period for today if none is open, records an expense, finds its journal
 * entry and sees a balanced trial balance. Data is synthetic and marked TEST.
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
  const [user] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Accounting') RETURNING id", [username]);
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

const tehranToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function createAccount(page: Page, code: string, name: string, type: string, subtype: string) {
  const form = page.getByTestId("admin-account-create");
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Type").selectOption(type);
  await form.getByLabel("Role").selectOption(subtype);
  await page.getByTestId("admin-account-create-submit").click();
  await expect(form.getByTestId("form-success")).toBeVisible();
  await expect(page.getByTestId("admin-accounts-list")).toContainText(code);
}

test("a Business Admin records an expense and sees it in the books", async ({ page }) => {
  test.setTimeout(120_000);
  const id = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const today = tehranToday();
  const covering = await sql<{ status: string }>("SELECT status::text FROM financial_periods WHERE start_date <= $1::date AND end_date >= $1::date", [today]);
  test.skip(covering.some((p) => p.status === "closed"), "today's period is already closed in this database");

  await signInBusinessAdmin(page);
  await page.goto("/en/admin/accounting");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/en/admin/accounting/accounts");
  await expect(page.getByTestId("admin-accounts-heading")).toBeVisible();
  const expense = { code: `97${id}`, name: `TEST rent ${id}` };
  const cash = { code: `98${id}`, name: `TEST cash ${id}` };
  await createAccount(page, expense.code, expense.name, "expense", "general");
  await createAccount(page, cash.code, cash.name, "asset", "cash");

  if (covering.length === 0) {
    await page.goto("/en/admin/accounting/periods");
    const form = page.getByTestId("admin-period-create");
    await form.getByLabel("Name").fill(`TEST ${today}`);
    await form.getByLabel("First day").fill(today);
    await form.getByLabel("Last day").fill(today);
    await page.getByTestId("admin-period-create-submit").click();
    // The desktop and phone runs go together: one creates the period, the other is told it overlaps.
    await expect(form.getByTestId("form-success").or(form.getByTestId("form-error"))).toBeVisible();
    if (await form.getByTestId("form-error").isVisible()) await expect(form.getByTestId("form-error")).toHaveText("This period overlaps another period.");
    await expect(page.getByTestId("admin-periods-list")).toContainText(`TEST ${today}`);
  }

  await page.goto("/en/admin/accounting/money");
  await expect(page.getByTestId("admin-money-heading")).toBeVisible();
  const form = page.getByTestId("admin-expense-create");
  await form.getByLabel(/^Amount/).fill("25000");
  await form.getByLabel("Expense account").selectOption({ label: `${expense.code} · ${expense.name}` });
  await form.getByLabel("Paid from").selectOption({ label: `${cash.code} · ${cash.name}` });
  await form.getByLabel("Paid to (optional)").fill("TEST landlord");
  await form.getByLabel("Description").fill(`TEST rent ${id}`);
  await page.getByTestId("admin-expense-create-submit").click();
  await expect(form.getByTestId("form-success")).toBeVisible();
  const row = page.getByTestId("admin-expense-row").filter({ hasText: `TEST rent ${id}` }).first();
  await expect(row).toBeVisible();

  // The expense's journal entry: debit the expense, credit the cash account.
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/en\/admin\/accounting\/journal\/\d+$/);
  await expect(page.getByText(expense.code).first()).toBeVisible();
  await expect(page.getByText(cash.code).first()).toBeVisible();
  const [posted] = await sql<{ debit: string; credit: string }>(
    "SELECT sum(e.debit)::text AS debit, sum(e.credit)::text AS credit FROM accounting_entries e JOIN financial_accounts a ON a.id = e.account_id WHERE a.code = ANY($1)",
    [[expense.code, cash.code]],
  );
  expect(posted!.debit).toBe(posted!.credit);
  expect(BigInt(posted!.debit)).toBeGreaterThan(0n);

  await page.goto(`/en/admin/accounting/reports?to=${today}`);
  await expect(page.getByTestId("admin-report-trial")).toContainText(expense.code);
  await expect(page.getByTestId("admin-report-balanced")).toHaveText("Balanced");
});
