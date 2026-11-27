/**
 * Phase 4: authentication, sessions, MFA, OTP and the authorize() engine,
 * exercised through the real services on PostgreSQL. Users created here are
 * committed (the services use their own connections); they are synthetic
 * (test-...) and never Super Admins, so the last-Super-Admin tests elsewhere
 * are unaffected.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import { hashPassword } from "@/lib/security/password";
import { sha256Hex } from "@/lib/security/tokens";
import { totp } from "@/lib/security/totp";
import {
  adminActor,
  adminPasswordLogin,
  confirmMfaEnrolment,
  getAdminContext,
  startMfaEnrolment,
  verifyAdminMfa,
  type AdminContext,
} from "@/modules/identity/service/admin-auth";
import {
  getCustomer,
  requestPhoneOtp,
  setSmsSenderForTests,
  verifyPhoneOtp,
} from "@/modules/identity/service/customer-auth";
import { endSession } from "@/modules/identity/service/sessions";
import type { SmsMessage, SmsSender } from "@/modules/identity/sms/sms-adapter";
import type { Actor } from "@/modules/rbac/domain/actor";
import { PERMISSIONS, SYSTEM_ROLES } from "@/modules/rbac/domain/permission-catalogue";
import { authorize, AuthzError, loadEffectivePermissions, MfaRequiredError } from "@/modules/rbac/service/authorize";
import { createFirstSuperAdmin, insertFirstSuperAdmin } from "../../scripts/lib/create-super-admin";
import { inTx, one, pool, uid } from "./helpers";

const PASSWORD = "integration test password";
let ipCounter = 0;
/** A fresh documentation-range IP per test, so per-IP limits don't leak between tests. */
function freshMeta(): RequestMeta {
  ipCounter += 1;
  return { ipAddress: `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`, userAgent: "vitest", requestId: null };
}

/**
 * A custom level-3 role holding only non-financial permissions (default Store
 * Staff can propose price changes, which makes TOTP mandatory for them).
 */
let viewerRole: string | undefined;
async function viewerRoleKey(): Promise<string> {
  if (viewerRole) return viewerRole;
  const key = `test_viewer_${uid().toLowerCase()}`;
  const client = await pool.connect();
  try {
    const role = await one<{ id: string }>(client, "INSERT INTO roles (key, name, level) VALUES ($1, 'TEST VIEWER', 3) RETURNING id", [key]);
    await client.query(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key IN ('brand.manage', 'vehicle.manage')",
      [role.id],
    );
  } finally {
    client.release();
  }
  viewerRole = key;
  return key;
}

let passwordHash: string;
async function createAdmin(roleKey: string, opts: { status?: string } = {}): Promise<{ userId: string; username: string }> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = `test-adm-${uid().toLowerCase()}`;
  const client = await pool.connect();
  try {
    const user = await one<{ id: string }>(
      client,
      "INSERT INTO users (username, name, status) VALUES ($1, 'TEST ADMIN', $2::user_status) RETURNING id",
      [username, opts.status ?? "active"],
    );
    await client.query(
      "INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)",
      [user.id, user.id, passwordHash],
    );
    await client.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2", [user.id, roleKey]);
    return { userId: user.id, username };
  } finally {
    client.release();
  }
}

async function context(token: string, now = new Date()): Promise<AdminContext> {
  const ctx = await getAdminContext(token, now);
  if (!ctx) throw new Error("expected a session");
  return ctx;
}

/** Signs in and enrols TOTP; returns the full-session context, secret and backup codes. */
async function enrolledAdmin(roleKey: string, now = new Date()) {
  const admin = await createAdmin(roleKey);
  const meta = freshMeta();
  const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, meta, now);
  if (login.status !== "ok") throw new Error("login failed");
  const pending = await context(login.session.token, now);
  const enrolment = await startMfaEnrolment(pending);
  if (!enrolment) throw new Error("no enrolment");
  const done = await confirmMfaEnrolment(pending, totp(enrolment.secret, now.getTime()), meta, now);
  if (done.status !== "ok") throw new Error("enrolment failed");
  return { ...admin, secret: enrolment.secret, backupCodes: done.backupCodes, token: done.session.token, meta };
}

afterAll(async () => {
  await prisma().$disconnect();
});

describe("first Super Admin (CLI)", () => {
  it("validates input before touching the database", async () => {
    const fakeDb = { query: () => Promise.reject(new Error("must not be called")) } as never;
    expect(await createFirstSuperAdmin(fakeDb, { username: "A", email: null, name: "x", password: PASSWORD })).toEqual({
      ok: false,
      error: "invalid_username",
    });
    expect(await createFirstSuperAdmin(fakeDb, { username: "owner", email: "bad", name: "x", password: PASSWORD })).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(await createFirstSuperAdmin(fakeDb, { username: "owner", email: null, name: "x", password: "short" })).toMatchObject({
      ok: false,
      error: "weak_password",
    });
  });

  it("creates one Super Admin with a hashed password and an audit row, then refuses a second", async () => {
    await inTx(async (db) => {
      // Other test files create Super Admins in the shared test database, and
      // the run order is not fixed: inside this rolled-back transaction, start
      // from an empty system as the CLI expects.
      await db.query("ALTER TABLE user_roles DISABLE TRIGGER user_roles_last_super_admin");
      await db.query("DELETE FROM user_roles WHERE role_id = (SELECT id FROM roles WHERE key = 'super_admin')");
      await db.query("ALTER TABLE user_roles ENABLE TRIGGER user_roles_last_super_admin");
      const hash = await hashPassword(PASSWORD);
      const first = await insertFirstSuperAdmin(db, { username: "test-owner", email: null, name: "TEST OWNER", passwordHash: hash });
      expect(first.ok).toBe(true);
      const userId = (first as { userId: string }).userId;
      const role = await one<{ key: string; level: number }>(
        db,
        "SELECT r.key, r.level FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
        [userId],
      );
      expect(role).toEqual({ key: "super_admin", level: 1 });
      const account = await one<{ password_hash: string }>(db, "SELECT password_hash FROM auth_accounts WHERE user_id = $1", [userId]);
      expect(account.password_hash).toMatch(/^\$argon2id\$/);
      expect(account.password_hash).not.toContain(PASSWORD);
      await one(db, "SELECT 1 FROM audit_logs WHERE action = 'user.create_first_super_admin' AND entity_id = $1", [userId]);

      const second = await insertFirstSuperAdmin(db, { username: "test-owner-2", email: null, name: "x", passwordHash: hash });
      expect(second).toEqual({ ok: false, error: "super_admin_exists" });
    });
  });
});

describe("admin password sign-in", () => {
  it("rejects wrong passwords and unknown users with the same answer, and records attempts", async () => {
    const admin = await createAdmin("business_admin");
    const meta = freshMeta();
    expect(await adminPasswordLogin({ identifier: admin.username, password: "wrong password!!" }, meta)).toEqual({ status: "invalid" });
    expect(await adminPasswordLogin({ identifier: "test-nobody-xyz", password: PASSWORD }, meta)).toEqual({ status: "invalid" });
    const attempts = await pool.query(
      "SELECT failure_reason FROM login_attempts WHERE identifier IN ($1, 'test-nobody-xyz') ORDER BY created_at",
      [admin.username],
    );
    expect(attempts.rows.map((r) => r.failure_reason)).toEqual(["bad_password", "unknown_user"]);
  });

  it("accepts the identifier case-insensitively and with Persian digits", async () => {
    const admin = await createAdmin("store_staff");
    const fancy = ` ${admin.username.toUpperCase()} `;
    const result = await adminPasswordLogin({ identifier: fancy, password: PASSWORD }, freshMeta());
    expect(result.status).toBe("ok");
  });

  it("refuses disabled users and users without an admin role", async () => {
    const disabled = await createAdmin("business_admin", { status: "disabled" });
    expect((await adminPasswordLogin({ identifier: disabled.username, password: PASSWORD }, freshMeta())).status).toBe("invalid");
    const customer = await createAdmin("customer");
    expect((await adminPasswordLogin({ identifier: customer.username, password: PASSWORD }, freshMeta())).status).toBe("invalid");
  });

  it("rate-limits an account from one address after 5 failures, without locking the owner out elsewhere", async () => {
    const admin = await createAdmin("business_admin");
    const attacker = freshMeta();
    for (let i = 0; i < 5; i += 1) {
      await adminPasswordLogin({ identifier: admin.username, password: `wrong-${i}-password` }, attacker);
    }
    expect(await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, attacker)).toEqual({ status: "rate_limited" });
    expect((await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta())).status).toBe("ok");
    await one(pool as never, "SELECT 1 FROM security_events WHERE type = 'login.rate_limited' AND details->>'identifier' = $1 LIMIT 1", [
      admin.username,
    ]);
  });

  it("rate-limits an account after 50 failures from many addresses", async () => {
    const admin = await createAdmin("business_admin");
    for (let i = 0; i < 50; i += 1) {
      await adminPasswordLogin({ identifier: admin.username, password: `wrong-${i}-password` }, freshMeta());
    }
    expect(await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta())).toEqual({ status: "rate_limited" });
  });

  it("puts requests without a valid client IP in one shared bucket instead of skipping the IP limit", async () => {
    const noIp: RequestMeta = { ipAddress: null, userAgent: "vitest", requestId: null };
    for (let i = 0; i < 20; i += 1) {
      await adminPasswordLogin({ identifier: `test-noip-${i}-${uid()}`, password: "x" }, noIp);
    }
    const admin = await createAdmin(await viewerRoleKey());
    expect(await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, noIp)).toEqual({ status: "rate_limited" });
    expect((await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta())).status).toBe("ok");
  });

  it("rate-limits an IP address after 20 failures across accounts", async () => {
    const meta = freshMeta();
    for (let i = 0; i < 20; i += 1) {
      await adminPasswordLogin({ identifier: `test-nobody-${i}-${uid()}`, password: "x" }, meta);
    }
    const admin = await createAdmin("business_admin");
    expect(await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, meta)).toEqual({ status: "rate_limited" });
    expect((await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta())).status).toBe("ok");
  });

  it("stores only the SHA-256 of the session token", async () => {
    const admin = await createAdmin(await viewerRoleKey());
    const result = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta());
    if (result.status !== "ok") throw new Error("login failed");
    const rows = await pool.query("SELECT token_hash FROM sessions WHERE user_id = $1", [admin.userId]);
    expect(rows.rows).toEqual([{ token_hash: sha256Hex(result.session.token) }]);
  });
});

describe("two-factor sign-in (TOTP)", () => {
  it("makes Business Admins enrol TOTP before anything else, then rotates the session", async () => {
    const now = new Date();
    const admin = await createAdmin("business_admin");
    const meta = freshMeta();
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, meta, now);
    expect(login).toMatchObject({ status: "ok", next: "setup" });
    if (login.status !== "ok") return;
    // A pending session is short-lived.
    expect(login.session.expiresAt.getTime() - now.getTime()).toBe(10 * 60_000);
    const pending = await context(login.session.token, now);
    expect(pending.mfa).toBe("setup");

    const enrolment = await startMfaEnrolment(pending);
    expect(enrolment?.uri).toMatch(/^otpauth:\/\/totp\/Clicksp%3A/);
    const stored = await one<{ secret_encrypted: string }>(pool as never, "SELECT secret_encrypted FROM user_mfa WHERE user_id = $1", [
      admin.userId,
    ]);
    expect(stored.secret_encrypted).not.toContain(enrolment!.secret);

    expect(await confirmMfaEnrolment(pending, "000000", meta, now)).toEqual({ status: "invalid" });
    const done = await confirmMfaEnrolment(pending, totp(enrolment!.secret, now.getTime()), meta, now);
    expect(done.status).toBe("ok");
    if (done.status !== "ok") return;
    expect(done.backupCodes).toHaveLength(10);
    expect(done.backupCodes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Old (pending) session is revoked; the new one is a full session.
    expect(await getAdminContext(login.session.token, now)).toBeNull();
    const full = await context(done.session.token, now);
    expect(full.mfa).toBe("ok");
    expect(full.mfaEnrolled).toBe(true);
    await one(pool as never, "SELECT 1 FROM audit_logs WHERE action = 'auth.mfa_enrolled' AND entity_id = $1", [admin.userId]);
  });

  it("asks enrolled admins for a code on every sign-in and refuses a replayed code", async () => {
    const now = new Date();
    const admin = await enrolledAdmin("business_admin", now);
    const later = new Date(now.getTime() + 60_000);
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), later);
    expect(login).toMatchObject({ status: "ok", next: "challenge" });
    if (login.status !== "ok") return;
    const pending = await context(login.session.token, later);
    expect(pending.mfa).toBe("challenge");

    // The enrolment code (an earlier time step) cannot be replayed.
    expect((await verifyAdminMfa(pending, totp(admin.secret, now.getTime()), admin.meta, later)).status).toBe("invalid");
    const ok = await verifyAdminMfa(pending, totp(admin.secret, later.getTime()), admin.meta, later);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok" || !ok.session) throw new Error("expected a rotated session");
    expect((await context(ok.session.token, later)).mfa).toBe("ok");
    // The same code again (same step) is refused.
    const again = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), later);
    if (again.status !== "ok") throw new Error("login failed");
    const pending2 = await context(again.session.token, later);
    expect((await verifyAdminMfa(pending2, totp(admin.secret, later.getTime()), admin.meta, later)).status).toBe("invalid");
  });

  it("accepts each backup code once", async () => {
    const admin = await enrolledAdmin("business_admin");
    const signIn = async () => {
      const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta());
      if (login.status !== "ok") throw new Error("login failed");
      return context(login.session.token);
    };
    const code = admin.backupCodes[0]!;
    expect((await verifyAdminMfa(await signIn(), code.toLowerCase(), admin.meta)).status).toBe("ok");
    expect((await verifyAdminMfa(await signIn(), code, admin.meta)).status).toBe("invalid");
    await one(pool as never, "SELECT 1 FROM security_events WHERE type = 'mfa.backup_code_used' AND user_id = $1", [admin.userId]);
  });

  it("locks TOTP for 15 minutes after 5 wrong codes", async () => {
    const now = new Date();
    const admin = await enrolledAdmin("business_admin", now);
    const later = new Date(now.getTime() + 60_000);
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), later);
    if (login.status !== "ok") throw new Error("login failed");
    const pending = await context(login.session.token, later);
    const results: string[] = [];
    for (let i = 0; i < 5; i += 1) results.push((await verifyAdminMfa(pending, "111111", admin.meta, later)).status);
    expect(results).toEqual(["invalid", "invalid", "invalid", "invalid", "locked"]);
    expect((await verifyAdminMfa(pending, totp(admin.secret, later.getTime()), admin.meta, later)).status).toBe("locked");
    const afterLock = new Date(later.getTime() + 16 * 60_000);
    const relogin = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), afterLock);
    if (relogin.status !== "ok") throw new Error("login failed");
    const fresh = await context(relogin.session.token, afterLock);
    expect((await verifyAdminMfa(fresh, totp(admin.secret, afterLock.getTime()), admin.meta, afterLock)).status).toBe("ok");
  });

  it("never allows more than 5 guesses, even in parallel", async () => {
    const now = new Date();
    const admin = await enrolledAdmin("business_admin", now);
    const later = new Date(now.getTime() + 60_000);
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), later);
    if (login.status !== "ok") throw new Error("login failed");
    const pending = await context(login.session.token, later);
    const results = await Promise.all(Array.from({ length: 15 }, () => verifyAdminMfa(pending, "111111", admin.meta, later)));
    expect(results.filter((r) => r.status === "invalid").length).toBeLessThanOrEqual(4);
    expect(results.filter((r) => r.status === "locked").length).toBeGreaterThanOrEqual(11);
    const failures = await pool.query("SELECT count(*)::int AS n FROM security_events WHERE type IN ('mfa.failed', 'mfa.locked') AND user_id = $1", [
      admin.userId,
    ]);
    expect(failures.rows[0].n).toBe(5);
  });

  it("completes an enrolment only once when confirmed twice in parallel", async () => {
    const now = new Date();
    const admin = await createAdmin("business_admin");
    const meta = freshMeta();
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, meta, now);
    if (login.status !== "ok") throw new Error("login failed");
    const pending = await context(login.session.token, now);
    const enrolment = await startMfaEnrolment(pending);
    const code = totp(enrolment!.secret, now.getTime());
    const results = await Promise.all([confirmMfaEnrolment(pending, code, meta, now), confirmMfaEnrolment(pending, code, meta, now)]);
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    // A verified enrolment is never replaced by a new pending secret.
    expect(await startMfaEnrolment(pending)).toBeNull();
  });

  it("requires TOTP for Store Staff with pricing permissions, not for staff without money access", async () => {
    const staff = await createAdmin("store_staff");
    expect(await adminPasswordLogin({ identifier: staff.username, password: PASSWORD }, freshMeta())).toMatchObject({
      status: "ok",
      next: "setup",
    });
    const viewer = await createAdmin(await viewerRoleKey());
    expect(await adminPasswordLogin({ identifier: viewer.username, password: PASSWORD }, freshMeta())).toMatchObject({
      status: "ok",
      next: "ok",
    });
  });
});

describe("admin sessions", () => {
  it("time out after 30 idle minutes and end at logout", async () => {
    const now = new Date();
    const admin = await createAdmin(await viewerRoleKey());
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), now);
    if (login.status !== "ok") throw new Error("login failed");
    expect(await getAdminContext(login.session.token, new Date(now.getTime() + 29 * 60_000))).not.toBeNull();
    // last_seen_at was refreshed at +29 min, so +58 min is still within 30 idle minutes.
    expect(await getAdminContext(login.session.token, new Date(now.getTime() + 58 * 60_000))).not.toBeNull();
    expect(await getAdminContext(login.session.token, new Date(now.getTime() + 89 * 60_000))).toBeNull();
    const revoked = await one<{ revoked_reason: string }>(pool as never, "SELECT revoked_reason FROM sessions WHERE token_hash = $1", [
      sha256Hex(login.session.token),
    ]);
    expect(revoked.revoked_reason).toBe("idle_timeout");

    const second = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta());
    if (second.status !== "ok") throw new Error("login failed");
    expect(await endSession(second.session.token, "admin")).toBe(admin.userId);
    expect(await getAdminContext(second.session.token)).toBeNull();
  });

  it("end at the 12-hour absolute limit even when active", async () => {
    const now = new Date();
    const admin = await createAdmin(await viewerRoleKey());
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta(), now);
    if (login.status !== "ok") throw new Error("login failed");
    for (let m = 20; m < 12 * 60; m += 20) {
      expect(await getAdminContext(login.session.token, new Date(now.getTime() + m * 60_000))).not.toBeNull();
    }
    expect(await getAdminContext(login.session.token, new Date(now.getTime() + 12 * 60 * 60_000))).toBeNull();
  });

  it("stop working when the user loses the admin role or is disabled", async () => {
    const admin = await createAdmin(await viewerRoleKey());
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta());
    if (login.status !== "ok") throw new Error("login failed");
    await pool.query("DELETE FROM user_roles WHERE user_id = $1", [admin.userId]);
    expect(await getAdminContext(login.session.token)).toBeNull();

    const other = await createAdmin(await viewerRoleKey());
    const login2 = await adminPasswordLogin({ identifier: other.username, password: PASSWORD }, freshMeta());
    if (login2.status !== "ok") throw new Error("login failed");
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [other.userId]);
    expect(await getAdminContext(login2.session.token)).toBeNull();
  });

  it("ignore garbage and customer tokens", async () => {
    expect(await getAdminContext(undefined)).toBeNull();
    expect(await getAdminContext("x".repeat(43))).toBeNull();
    expect(await getAdminContext("'; DROP TABLE sessions; --aaaaaaaaaa")).toBeNull();
  });
});

describe("customer sign-in with mobile number and SMS code", () => {
  let outbox: SmsMessage[] = [];
  const fakeSms: SmsSender = {
    name: "test",
    enabled: true,
    async send(message) {
      outbox.push(message);
      return { ok: true };
    },
  };
  beforeEach(() => {
    outbox = [];
    setSmsSenderForTests(fakeSms);
  });
  afterAll(() => setSmsSenderForTests(undefined));

  const phone = () => `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
  const render = (code: string) => `code ${code}`;
  const codeFrom = (m: SmsMessage | undefined) => m!.text.replace("code ", "");

  it("is unavailable without an SMS provider", async () => {
    setSmsSenderForTests({ name: "none", enabled: false, send: () => Promise.reject(new Error("no")) });
    expect(await requestPhoneOtp({ phone: phone(), renderText: render }, freshMeta())).toEqual({ status: "unavailable" });
  });

  it("rejects numbers that are not Iranian mobiles", async () => {
    expect(await requestPhoneOtp({ phone: "02112345678", renderText: render }, freshMeta())).toEqual({ status: "invalid_phone" });
  });

  it("signs up a new customer, stores only a keyed hash of the code, and signs in again later", async () => {
    const number = phone();
    const meta = freshMeta();
    const sent = await requestPhoneOtp({ phone: number.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!), renderText: render }, meta);
    expect(sent).toMatchObject({ status: "sent", phone: `+98${number.slice(1)}` });
    const code = codeFrom(outbox[0]);
    expect(code).toMatch(/^\d{6}$/);
    const token = await one<{ value_hash: string }>(pool as never, "SELECT value_hash FROM verification_tokens WHERE identifier = $1", [
      `+98${number.slice(1)}`,
    ]);
    expect(token.value_hash).not.toBe(sha256Hex(code));

    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyPhoneOtp({ phone: number, code: wrong }, meta)).toEqual({ status: "invalid_code" });
    const ok = await verifyPhoneOtp({ phone: number, code }, meta);
    expect(ok).toMatchObject({ status: "ok", isNewCustomer: true });
    if (ok.status !== "ok") return;
    const customer = await getCustomer(ok.session.token);
    expect(customer?.user.phoneNumber).toBe(`+98${number.slice(1)}`);
    const role = await one<{ key: string }>(
      pool as never,
      "SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
      [customer!.user.id],
    );
    expect(role.key).toBe("customer");
    // A used code cannot be used again.
    expect((await verifyPhoneOtp({ phone: number, code }, meta)).status).toBe("expired");
    // A customer session is never an admin session.
    expect(await getAdminContext(ok.session.token)).toBeNull();

    await requestPhoneOtp({ phone: number, renderText: render }, meta);
    const again = await verifyPhoneOtp({ phone: number, code: codeFrom(outbox[1]) }, meta);
    expect(again).toMatchObject({ status: "ok", isNewCustomer: false });
  });

  it("does not accept an admin session as a customer session", async () => {
    const admin = await createAdmin("store_staff");
    const login = await adminPasswordLogin({ identifier: admin.username, password: PASSWORD }, freshMeta());
    if (login.status !== "ok") throw new Error("login failed");
    expect(await getCustomer(login.session.token)).toBeNull();
  });

  it("allows 5 tries per code", async () => {
    const number = phone();
    const meta = freshMeta();
    await requestPhoneOtp({ phone: number, renderText: render }, meta);
    const code = codeFrom(outbox[0]);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect((await verifyPhoneOtp({ phone: number, code: wrong }, meta)).status).toBe("invalid_code");
    expect((await verifyPhoneOtp({ phone: number, code }, meta)).status).toBe("too_many_attempts");
  });

  it("expires codes after 3 minutes and only accepts the newest one", async () => {
    const number = phone();
    const meta = freshMeta();
    const now = new Date();
    await requestPhoneOtp({ phone: number, renderText: render }, meta, now);
    const first = codeFrom(outbox[0]);
    expect((await verifyPhoneOtp({ phone: number, code: first }, meta, new Date(now.getTime() + 181_000))).status).toBe("expired");

    await requestPhoneOtp({ phone: number, renderText: render }, meta, new Date(now.getTime() + 1000));
    const second = codeFrom(outbox[1]);
    if (first !== second) {
      expect((await verifyPhoneOtp({ phone: number, code: first }, meta, new Date(now.getTime() + 2000))).status).toBe("invalid_code");
    }
  });

  it("limits sends to 3 per number and 10 per IP address in 10 minutes", async () => {
    const number = phone();
    const results: string[] = [];
    for (let i = 0; i < 4; i += 1) results.push((await requestPhoneOtp({ phone: number, renderText: render }, freshMeta())).status);
    expect(results).toEqual(["sent", "sent", "sent", "rate_limited"]);

    const meta = freshMeta();
    const byIp: string[] = [];
    for (let i = 0; i < 11; i += 1) byIp.push((await requestPhoneOtp({ phone: phone(), renderText: render }, meta)).status);
    expect(byIp.filter((s) => s === "sent")).toHaveLength(10);
    expect(byIp[10]).toBe("rate_limited");
  });

  it("limits wrong codes per IP address across numbers", async () => {
    const meta = freshMeta();
    const statuses: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      const number = phone();
      await requestPhoneOtp({ phone: number, renderText: render }, freshMeta());
      const code = codeFrom(outbox.at(-1));
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i += 1) statuses.push((await verifyPhoneOtp({ phone: number, code: wrong }, meta)).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === "invalid_code")).toBe(true);
    expect(statuses.slice(20).every((s) => s === "rate_limited")).toBe(true);
  });

  it("refuses disabled customers", async () => {
    const number = phone();
    const meta = freshMeta();
    await requestPhoneOtp({ phone: number, renderText: render }, meta);
    const ok = await verifyPhoneOtp({ phone: number, code: codeFrom(outbox[0]) }, meta);
    if (ok.status !== "ok") throw new Error("sign-in failed");
    await pool.query("UPDATE users SET status = 'disabled' WHERE phone_number = $1", [`+98${number.slice(1)}`]);
    expect(await getCustomer(ok.session.token)).toBeNull();
    await requestPhoneOtp({ phone: number, renderText: render }, meta);
    expect((await verifyPhoneOtp({ phone: number, code: codeFrom(outbox[1]) }, meta)).status).toBe("account_disabled");
  });
});

describe("authorize(): every permission for each admin level", () => {
  const actors = new Map<string, Actor>();
  let category: string;
  let otherCategory: string;
  let warehouse: string;
  let otherWarehouse: string;

  async function actorFor(roleKey: string, mfaVerifiedAt: Date | null): Promise<Actor> {
    const admin = await createAdmin(roleKey);
    return {
      kind: "admin",
      userId: admin.userId,
      sessionId: null,
      level: SYSTEM_ROLES.find((r) => r.key === roleKey)!.level,
      permissions: await loadEffectivePermissions(admin.userId),
      mfaVerifiedAt,
      meta: freshMeta(),
    };
  }

  it("sets up one actor per level, with Store Staff scoped to one category and one warehouse", async () => {
    const client = await pool.connect();
    try {
      const cat = async () => (await one<{ id: string }>(client, "INSERT INTO categories (parent_id) VALUES (NULL) RETURNING id")).id;
      const wh = async () =>
        (await one<{ id: string }>(client, "INSERT INTO warehouses (code, name) VALUES ($1, 'TEST-WAREHOUSE') RETURNING id", [`TEST-${uid()}`])).id;
      category = await cat();
      otherCategory = await cat();
      warehouse = await wh();
      otherWarehouse = await wh();
    } finally {
      client.release();
    }
    for (const key of ["super_admin", "business_admin", "store_staff"]) {
      // Super Admin fixture: added with an expiring grant so it never counts as "the last Super Admin".
      actors.set(key, await actorFor(key === "super_admin" ? "business_admin" : key, new Date()));
    }
    // Make the first actor a real Super Admin (level 1) through an expiring assignment.
    const sa = actors.get("super_admin")!;
    await pool.query("DELETE FROM user_roles WHERE user_id = $1", [sa.userId]);
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id, expires_at) SELECT $1, id, now() + interval '1 day' FROM roles WHERE key = 'super_admin'",
      [sa.userId],
    );
    actors.set("super_admin", { ...sa, level: 1, permissions: await loadEffectivePermissions(sa.userId!) });

    const staff = actors.get("store_staff")!;
    await pool.query(
      `INSERT INTO user_role_scopes (user_role_id, scope_type, category_id)
       SELECT id, 'category', $2 FROM user_roles WHERE user_id = $1`,
      [staff.userId, category],
    );
    await pool.query(
      `INSERT INTO user_role_scopes (user_role_id, scope_type, warehouse_id)
       SELECT id, 'warehouse', $2 FROM user_roles WHERE user_id = $1`,
      [staff.userId, warehouse],
    );
    actors.set("store_staff", { ...staff, permissions: await loadEffectivePermissions(staff.userId!) });
  });

  const levels = [
    { role: "super_admin", bundle: "superAdmin" },
    { role: "business_admin", bundle: "businessAdmin" },
    { role: "store_staff", bundle: "storeStaff" },
  ] as const;

  for (const { role, bundle } of levels) {
    it(`${role}: allowed exactly the default bundle, denied everything else`, async () => {
      const actor = actors.get(role)!;
      const scopedStaff = role === "store_staff";
      for (const perm of PERMISSIONS) {
        const inScope = { categoryIds: [category], warehouseIds: [] as string[] };
        if (perm.scope === "warehouse") Object.assign(inScope, { categoryIds: [], warehouseIds: [warehouse] });
        const resource = perm.scope ? inScope : undefined;
        const call = authorize(actor, perm.key, resource);
        if (perm.defaults[bundle]) {
          await expect(call, `${role} ${perm.key}`).resolves.toBeUndefined();
        } else {
          await expect(call, `${role} ${perm.key}`).rejects.toBeInstanceOf(AuthzError);
        }
        if (perm.defaults[bundle] && scopedStaff && perm.scope) {
          const outside = perm.scope === "category" ? { categoryIds: [otherCategory] } : { warehouseIds: [otherWarehouse] };
          await expect(authorize(actor, perm.key, outside), `${perm.key} out of scope`).rejects.toBeInstanceOf(AuthzError);
          await expect(authorize(actor, perm.key), `${perm.key} without resource`).rejects.toBeInstanceOf(AuthzError);
        }
      }
    });
  }

  it("records every denial as a security event", async () => {
    const staff = actors.get("store_staff")!;
    await expect(authorize(staff, "role.manage", { type: "role", id: undefined })).rejects.toBeInstanceOf(AuthzError);
    const event = await one<{ details: { permission: string; reason: string } }>(
      pool as never,
      // This actor was refused many permissions above; look for this denial by its permission.
      "SELECT details FROM security_events WHERE type = 'authz.denied' AND user_id = $1 AND details->>'permission' = 'role.manage' ORDER BY occurred_at DESC LIMIT 1",
      [staff.userId],
    );
    expect(event.details).toMatchObject({ permission: "role.manage", reason: "not_granted" });
  });

  it("needs a recent TOTP check for MFA-marked permissions", async () => {
    const sa = actors.get("super_admin")!;
    const stale = { ...sa, mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) };
    await expect(authorize(stale, "role.manage")).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(authorize({ ...sa, mfaVerifiedAt: null }, "backup.run")).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(authorize(stale, "product.update")).resolves.toBeUndefined();
    await expect(authorize(sa, "role.manage")).resolves.toBeUndefined();
  });

  it("denies everything to customers and to expired role assignments", async () => {
    const customer = await actorFor("customer", new Date());
    expect(customer.permissions.size).toBe(0);
    await expect(authorize(customer, "product.view", { categoryIds: [category] })).rejects.toBeInstanceOf(AuthzError);

    const expiring = await actorFor("business_admin", new Date());
    await pool.query("UPDATE user_roles SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [expiring.userId]);
    expect((await loadEffectivePermissions(expiring.userId!)).size).toBe(0);
  });

  it("builds the admin actor from the session only", async () => {
    const admin = await enrolledAdmin("business_admin");
    const ctx = await context(admin.token);
    const actor = adminActor(ctx, admin.meta);
    expect(actor).toMatchObject({ kind: "admin", userId: admin.userId, level: 2 });
    expect(actor.mfaVerifiedAt).not.toBeNull();
    await expect(authorize(actor, "refund.create")).resolves.toBeUndefined();
    await expect(authorize(actor, "settings.system")).rejects.toBeInstanceOf(AuthzError);
  });
});
