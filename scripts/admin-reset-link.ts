/**
 * pnpm admin:reset-link --username owner [--reset-mfa] [--locale fa|en]
 *
 * Account recovery on the server: prints a one-time "set a new password" link
 * (valid 30 minutes) for an admin account and signs that account out
 * everywhere. With --reset-mfa the authenticator enrolment is removed too
 * (lost phone and backup codes); a new QR code is shown at the next sign-in.
 * Use it when the owner is locked out of the only Super Admin account; other
 * admins are reset by a Super Admin in the admin panel (People > Admins).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { issueResetLink } from "./lib/reset-link.ts";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    "reset-mfa": { type: "boolean", default: false },
    locale: { type: "string", default: "fa" },
  },
});

const MESSAGES: Record<string, string> = {
  not_found: "No account has that username.",
  not_admin: "That account is not an admin account.",
  disabled: "That account is disabled. A Super Admin can enable it from the admin panel first.",
};

const connectionString = process.env.DATABASE_URL;
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
if (!connectionString) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
if (!values.username) {
  console.error("Usage: pnpm admin:reset-link --username <username> [--reset-mfa] [--locale fa|en]");
  process.exit(1);
}
const locale = values.locale === "en" ? "en" : "fa";

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const result = await issueResetLink(client, { username: values.username, resetMfa: values["reset-mfa"] === true });
  if (!result.ok) {
    console.error(`Not issued: ${MESSAGES[result.error] ?? result.error}`);
    process.exitCode = 1;
  } else {
    console.log("One-time password link (valid 30 minutes, works once). Open it in a browser:\n");
    console.log(`  ${appUrl}/${locale}/admin/set-password#${result.token}\n`);
    console.log("The account has been signed out everywhere.");
    if (result.mfaRemoved) console.log("Two-factor sign-in was removed; a new QR code is shown at the next sign-in.");
  }
} finally {
  await client.end();
}
