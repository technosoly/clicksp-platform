/**
 * pnpm admin:create-super
 *
 * Creates the first Super Admin account on the server. Run it once after
 * `pnpm db:deploy && pnpm db:seed`. It asks for the details interactively;
 * the password is never echoed. Two-factor sign-in (TOTP) is set up on the
 * first login in the browser.
 *
 * Non-interactive use (e.g. inside a container):
 *   pnpm admin:create-super --username owner --name "Owner" [--email owner@example.com]
 *   with the password in the CLICKSP_ADMIN_PASSWORD environment variable.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { createFirstSuperAdmin } from "./lib/create-super-admin.ts";
import { PASSWORD_MIN_LENGTH } from "../src/lib/security/password.ts";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
  },
});

const interactive = process.stdin.isTTY === true;

async function ask(question: string, fallback?: string): Promise<string> {
  if (fallback !== undefined) return fallback;
  if (!interactive) throw new Error(`Missing value for "${question}" (no terminal to ask)`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it. */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let input = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") input = [...input].slice(0, -1).join("");
        else input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.CLICKSP_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!interactive) throw new Error("Set CLICKSP_ADMIN_PASSWORD when running without a terminal");
  for (;;) {
    const first = await askHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
    const second = await askHidden("Repeat the password: ");
    if (first === second) return first;
    console.log("The passwords do not match. Try again.");
  }
}

const MESSAGES: Record<string, string> = {
  super_admin_exists:
    "A Super Admin already exists. More admins are added from the admin panel by a signed-in Super Admin.",
  invalid_username: "Username: 3-50 characters, lower-case English letters, digits, dot, dash or underscore.",
  invalid_email: "That email address is not valid.",
  invalid_name: "Name is required (up to 120 characters).",
  identifier_taken: "That username or email is already used by another account.",
  roles_not_seeded: "System roles are missing. Run `pnpm db:deploy && pnpm db:seed` first.",
  weak_password: `The password is too weak: use at least ${PASSWORD_MIN_LENGTH} characters, different from the username.`,
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

console.log("Create the first Clicksp Super Admin\n");
const username = await ask("Username (for signing in, e.g. owner): ", values.username);
const name = await ask("Display name: ", values.name);
const email = await ask("Email (optional, press Enter to skip): ", values.email ?? (interactive ? undefined : ""));
const password = await readPassword();

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const result = await createFirstSuperAdmin(client, { username, name, email: email || null, password });
  if (!result.ok) {
    console.error(`\nNot created: ${MESSAGES[result.error] ?? result.error}`);
    process.exitCode = 1;
  } else {
    console.log(`\nSuper Admin "${username.toLowerCase()}" created.`);
    console.log("Next: open /fa/admin/login (or /en/admin/login), sign in, and scan the QR code with an");
    console.log("authenticator app (Google Authenticator, Microsoft Authenticator, Aegis...) to finish setup.");
  }
} finally {
  await client.end();
}
