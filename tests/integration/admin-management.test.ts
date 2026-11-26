/**
 * Phase 5: managing admin accounts, roles and permissions, password links,
 * own account, the audit view and the admin-phone guard, through the real
 * services on PostgreSQL. Actors are built like the app builds them (effective
 * permissions from the database). Users are committed and synthetic
 * (test-...). Super Admin test accounts get an expiring assignment, which the
 * last-Super-Admin guard does not count, so other suites are unaffected.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import type { RequestMeta } from "@/lib/http/request-meta";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { sha256Hex } from "@/lib/security/tokens";
import { listAuditTrail, listSecurityLog } from "@/modules/audit/service/audit-view";
import { changeOwnPassword, completePasswordLink, revokeOwnSession } from "@/modules/identity/service/account";
import {
  assignableRoles,
  changeAdminRole,
  createAdminUser,
  getManagedAdmin,
  issuePasswordLink,
  listManagedAdmins,
  resetAdminMfa,
  revokeAdminSessions,
  setAdminStatus,
  updateAdminUser,
} from "@/modules/identity/service/admin-users";
import { requestPhoneOtp, setSmsSenderForTests, verifyPhoneOtp } from "@/modules/identity/service/customer-auth";
import type { SmsMessage } from "@/modules/identity/sms/sms-adapter";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError, loadEffectivePermissions, MfaRequiredError } from "@/modules/rbac/service/authorize";
import { createRole, getRoleDetail, listRoles, setRolePermissions, updateRole } from "@/modules/rbac/service/roles";
import { issueResetLink } from "../../scripts/lib/reset-link";
import { one, pool, uid } from "./helpers";

type Level = "super_admin" | "business_admin" | "store_staff";
const PASSWORD = "integration test password";
let passwordHash: string;
let ip = 0;
const meta = (): RequestMeta => {
  ip += 1;
  return { ipAddress: `203.0.113.${(ip % 250) + 1}`, userAgent: "vitest", requestId: null };
};

async function createAccount(roleKey: Level | string, opts: { phone?: string } = {}): Promise<{ id: string; username: string }> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = `test-mgmt-${uid().toLowerCase()}`;
  const client = await pool.connect();
  try {
    const user = await one<{ id: string }>(
      client,
      "INSERT INTO users (username, name, phone_number) VALUES ($1, 'TEST MGMT', $2) RETURNING id",
      [username, opts.phone ?? null],
    );
    await client.query("INSERT INTO auth_accounts (user_id, provider_id, account_id, password_hash) VALUES ($1::uuid, 'credential', $2, $3)", [
      user.id,
      user.id,
      passwordHash,
    ]);
    // Expiring Super Admin assignments are not "active" for the last-Super-Admin guard.
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, expires_at)
       SELECT $1, id, CASE WHEN level = 1 THEN now() + interval '1 day' END FROM roles WHERE key = $2`,
      [user.id, roleKey],
    );
    return { id: user.id, username };
  } finally {
    client.release();
  }
}

async function sessionFor(userId: string): Promise<string> {
  const client = await pool.connect();
  try {
    const row = await one<{ id: string }>(
      client,
      `INSERT INTO sessions (user_id, token_hash, kind, expires_at, mfa_verified_at)
       VALUES ($1, $2, 'admin', now() + interval '1 hour', now()) RETURNING id`,
      [userId, sha256Hex(`${userId}-${uid()}`)],
    );
    return row.id;
  } finally {
    client.release();
  }
}

const LEVEL: Record<string, number> = { super_admin: 1, business_admin: 2, store_staff: 3 };

async function actorFor(roleKey: Level, opts: { mfaAgoMs?: number } = {}): Promise<Actor & { userId: string; sessionId: string }> {
  const { id } = await createAccount(roleKey);
  const sessionId = await sessionFor(id);
  return {
    kind: "admin",
    userId: id,
    sessionId,
    level: LEVEL[roleKey]!,
    permissions: await loadEffectivePermissions(id),
    mfaVerifiedAt: new Date(Date.now() - (opts.mfaAgoMs ?? 0)),
    meta: meta(),
  };
}

async function roleIdOf(key: string): Promise<string> {
  const client = await pool.connect();
  try {
    return (await one<{ id: string }>(client, "SELECT id FROM roles WHERE key = $1", [key])).id;
  } finally {
    client.release();
  }
}

async function q<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

const activeSessions = async (userId: string) =>
  Number((await q<{ n: string }>("SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [userId]))[0]!.n);

afterAll(async () => {
  await prisma().$disconnect();
});

describe("who can manage which accounts", () => {
  it("Super Admins see every admin level; Business Admins only Store Staff; Store Staff nobody", async () => {
    const sa = await actorFor("super_admin");
    const ba = await actorFor("business_admin");
    const st = await actorFor("store_staff");
    const staffAccount = await createAccount("store_staff");

    const saLevels = new Set((await listManagedAdmins(sa)).map((u) => u.role.level));
    expect(saLevels).toEqual(new Set([1, 2, 3]));
    const baList = await listManagedAdmins(ba);
    expect(baList.every((u) => u.role.level === 3)).toBe(true);
    expect(baList.some((u) => u.id === staffAccount.id)).toBe(true);
    expect(baList.some((u) => u.id === sa.userId || u.id === ba.userId)).toBe(false);
    await expect(listManagedAdmins(st)).rejects.toBeInstanceOf(AuthzError);

    expect((await assignableRoles(sa)).map((r) => r.level).sort()).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(new Set((await assignableRoles(ba)).map((r) => r.level))).toEqual(new Set([3]));
    expect(await assignableRoles(st)).toEqual([]);
  });

  it("a Business Admin can't open, create or promote to Super Admin or Business Admin accounts", async () => {
    const ba = await actorFor("business_admin");
    const otherSa = await createAccount("super_admin");
    const otherBa = await createAccount("business_admin");
    const staff = await createAccount("store_staff");

    await expect(getManagedAdmin(ba, otherSa.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(getManagedAdmin(ba, otherBa.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(setAdminStatus(ba, otherSa.id, "disabled")).rejects.toBeInstanceOf(AuthzError);
    await expect(issuePasswordLink(ba, otherBa.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(resetAdminMfa(ba, otherSa.id)).rejects.toBeInstanceOf(AuthzError);
    for (const key of ["super_admin", "business_admin"]) {
      await expect(
        createAdminUser(ba, { username: `test-x-${uid().toLowerCase()}`, email: "", name: "X", roleId: await roleIdOf(key) }),
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(changeAdminRole(ba, staff.id, await roleIdOf(key))).rejects.toBeInstanceOf(AuthzError);
    }
    // Every denial is recorded.
    const events = await q("SELECT 1 FROM security_events WHERE user_id = $1 AND type = 'authz.denied'", [ba.userId]);
    expect(events.length).toBeGreaterThanOrEqual(9);
    // The staff account still has its role.
    expect((await getManagedAdmin(ba, staff.id)).status).toBe("ok");
  });

  it("nobody manages their own account here, and unknown ids are not found", async () => {
    const sa = await actorFor("super_admin");
    expect(await setAdminStatus(sa, sa.userId, "disabled")).toEqual({ status: "self" });
    expect(await changeAdminRole(sa, sa.userId, await roleIdOf("store_staff"))).toEqual({ status: "self" });
    expect(await issuePasswordLink(sa, sa.userId)).toEqual({ status: "self" });
    expect(await resetAdminMfa(sa, sa.userId)).toEqual({ status: "self" });
    expect(await updateAdminUser(sa, sa.userId, { name: "x", email: "" })).toEqual({ status: "self" });
    expect(await getManagedAdmin(sa, "00000000-0000-7000-8000-000000000000")).toEqual({ status: "not_found" });
    expect(await getManagedAdmin(sa, "not-a-uuid")).toEqual({ status: "not_found" });
    // Customers are not admin accounts.
    const client = await pool.connect();
    const customer = await one<{ id: string }>(client, "INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [
      `+98912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
    ]);
    client.release();
    expect(await getManagedAdmin(sa, customer.id)).toEqual({ status: "not_found" });
  });

  it("changes need a fresh two-factor check; reading lists does not", async () => {
    const ba = await actorFor("business_admin", { mfaAgoMs: 10 * 60_000 });
    const staff = await createAccount("store_staff");
    expect(Array.isArray(await listManagedAdmins(ba))).toBe(true);
    expect((await getManagedAdmin(ba, staff.id)).status).toBe("ok");
    await expect(setAdminStatus(ba, staff.id, "disabled")).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(issuePasswordLink(ba, staff.id)).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(
      createAdminUser(ba, { username: `test-x-${uid().toLowerCase()}`, email: "", name: "X", roleId: await roleIdOf("store_staff") }),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });
});

describe("account lifecycle", () => {
  it("creates an account without a password and an invitation link that sets it once", async () => {
    const ba = await actorFor("business_admin");
    const username = `Test-New-${uid()}`;
    const created = await createAdminUser(ba, { username: ` ${username} `, email: "", name: "  New   Staff ", roleId: await roleIdOf("store_staff") });
    if (created.status !== "ok") throw new Error(created.status);
    const [user] = await q<{ username: string; name: string; status: string }>("SELECT username, name, status::text FROM users WHERE id = $1", [created.userId]);
    expect(user).toEqual({ username: username.toLowerCase(), name: "New Staff", status: "active" });
    expect(await q("SELECT 1 FROM auth_accounts WHERE user_id = $1", [created.userId])).toHaveLength(0);
    const [token] = await q<{ value_hash: string; purpose: string; hours: string }>(
      "SELECT value_hash, purpose::text, round(extract(epoch FROM expires_at - created_at) / 3600) AS hours FROM verification_tokens WHERE user_id = $1",
      [created.userId],
    );
    expect(token!.purpose).toBe("admin_invite");
    expect(Number(token!.hours)).toBe(72);
    expect(token!.value_hash).toBe(sha256Hex(created.token));
    expect(token!.value_hash).not.toContain(created.token);
    const audit = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1", [created.userId]);
    expect(audit.map((a) => a.action)).toContain("staff.created");

    // Duplicate username, bad input.
    expect(await createAdminUser(ba, { username, email: "", name: "x", roleId: await roleIdOf("store_staff") })).toEqual({ status: "taken", field: "username" });
    expect((await createAdminUser(ba, { username: "A", email: "", name: "x", roleId: await roleIdOf("store_staff") })).status).toBe("invalid");
    expect((await createAdminUser(ba, { username: "valid.name", email: "nope", name: "x", roleId: await roleIdOf("store_staff") })).status).toBe("invalid");

    // A weak password doesn't use up the link.
    expect(await completePasswordLink({ token: created.token, password: "short" }, meta())).toEqual({ status: "weak_password", problem: "too_short" });
    expect(await completePasswordLink({ token: created.token, password: "a good long password" }, meta())).toEqual({ status: "ok", purpose: "admin_invite" });
    const [hash] = await q<{ password_hash: string }>("SELECT password_hash FROM auth_accounts WHERE user_id = $1", [created.userId]);
    expect(await verifyPassword(hash!.password_hash, "a good long password")).toBe(true);
    expect(await completePasswordLink({ token: created.token, password: "another long password" }, meta())).toEqual({ status: "invalid_link" });
  });

  it("a reset link replaces earlier links, expires, and signs the account out everywhere", async () => {
    const sa = await actorFor("super_admin");
    const target = await createAccount("business_admin");
    await sessionFor(target.id);
    const first = await issuePasswordLink(sa, target.id);
    const second = await issuePasswordLink(sa, target.id);
    if (first.status !== "ok" || second.status !== "ok") throw new Error("not issued");
    expect(second.purpose).toBe("password_reset");
    expect(Math.round((second.expiresAt.getTime() - Date.now()) / 60_000)).toBe(30);
    expect(await completePasswordLink({ token: first.token, password: "a good long password" }, meta())).toEqual({ status: "invalid_link" });
    // Not usable after expiry.
    expect(await completePasswordLink({ token: second.token, password: "a good long password" }, meta(), new Date(Date.now() + 31 * 60_000))).toEqual({
      status: "invalid_link",
    });
    expect(await activeSessions(target.id)).toBe(1);
    expect(await completePasswordLink({ token: second.token, password: "a good long password" }, meta())).toEqual({ status: "ok", purpose: "password_reset" });
    expect(await activeSessions(target.id)).toBe(0);
    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1", [target.id])).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.password_link_issued", "auth.password_reset"]));
  });

  it("refuses links for disabled accounts and limits wrong links per IP", async () => {
    const sa = await actorFor("super_admin");
    const target = await createAccount("store_staff");
    const link = await issuePasswordLink(sa, target.id);
    if (link.status !== "ok") throw new Error("not issued");
    expect(await setAdminStatus(sa, target.id, "disabled")).toEqual({ status: "ok" });
    expect(await completePasswordLink({ token: link.token, password: "a good long password" }, meta())).toEqual({ status: "invalid_link" });

    const sameIp: RequestMeta = { ipAddress: "198.18.0.77", userAgent: "vitest", requestId: null };
    for (let i = 0; i < 20; i++) {
      expect((await completePasswordLink({ token: "x".repeat(43), password: "a good long password" }, sameIp)).status).toBe("invalid_link");
    }
    expect(await completePasswordLink({ token: "x".repeat(43), password: "a good long password" }, sameIp)).toEqual({ status: "rate_limited" });
  });

  it("role changes, disabling, two-factor reset and sign-out revoke the target's sessions", async () => {
    const sa = await actorFor("super_admin");
    const target = await createAccount("store_staff");
    const client = await pool.connect();
    await client.query("INSERT INTO user_mfa (user_id, secret_encrypted, backup_code_hashes, is_verified) VALUES ($1, 'x', '{}', true)", [target.id]);
    await client.query("UPDATE users SET two_factor_enabled = true WHERE id = $1", [target.id]);
    client.release();

    await sessionFor(target.id);
    expect(await changeAdminRole(sa, target.id, await roleIdOf("business_admin"))).toEqual({ status: "ok" });
    expect(await activeSessions(target.id)).toBe(0);
    const roles = await q<{ key: string }>("SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [target.id]);
    expect(roles.map((r) => r.key)).toEqual(["business_admin"]);

    await sessionFor(target.id);
    expect(await resetAdminMfa(sa, target.id)).toEqual({ status: "ok" });
    expect(await q("SELECT 1 FROM user_mfa WHERE user_id = $1", [target.id])).toHaveLength(0);
    expect(await activeSessions(target.id)).toBe(0);

    await sessionFor(target.id);
    await sessionFor(target.id);
    expect(await revokeAdminSessions(sa, target.id)).toEqual({ status: "ok", count: 2 });

    await sessionFor(target.id);
    expect(await setAdminStatus(sa, target.id, "disabled")).toEqual({ status: "ok" });
    expect(await activeSessions(target.id)).toBe(0);
    expect(await setAdminStatus(sa, target.id, "active")).toEqual({ status: "ok" });
    const actions = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq", [target.id])).map((a) => a.action);
    expect(actions).toEqual(["admin.role_changed", "admin.mfa_reset", "admin.sessions_revoked", "admin.disabled", "admin.enabled"]);
  });

  it("the server recovery command issues a link that works once", async () => {
    const target = await createAccount("business_admin");
    await sessionFor(target.id);
    const client = await pool.connect();
    let result;
    try {
      result = await issueResetLink(client, { username: target.username, resetMfa: true });
      expect(await issueResetLink(client, { username: "test-nobody-here", resetMfa: false })).toEqual({ ok: false, error: "not_found" });
    } finally {
      client.release();
    }
    if (!result.ok) throw new Error(result.error);
    expect(await activeSessions(target.id)).toBe(0);
    expect(await completePasswordLink({ token: result.token, password: "a recovered long password" }, meta())).toEqual({ status: "ok", purpose: "password_reset" });
    expect(await completePasswordLink({ token: result.token, password: "a recovered long password" }, meta())).toEqual({ status: "invalid_link" });
  });
});

describe("own account", () => {
  it("changes the password with the current one and signs out the other sessions only", async () => {
    const ba = await actorFor("business_admin");
    const other = await sessionFor(ba.userId);
    expect(await changeOwnPassword(ba, { current: "wrong password!!", next: "a new long password" })).toEqual({ status: "wrong_password" });
    expect(await changeOwnPassword(ba, { current: PASSWORD, next: "short" })).toEqual({ status: "weak_password", problem: "too_short" });
    expect(await changeOwnPassword(ba, { current: PASSWORD, next: PASSWORD })).toEqual({ status: "weak_password", problem: "same_as_current" });
    expect(await changeOwnPassword(ba, { current: PASSWORD, next: "a new long password" })).toEqual({ status: "ok" });
    const rows = await q<{ id: string; revoked: boolean }>("SELECT id, revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id = $1", [ba.userId]);
    expect(rows.find((r) => r.id === other)!.revoked).toBe(true);
    expect(rows.find((r) => r.id === ba.sessionId)!.revoked).toBe(false);
  });

  it("locks password changes after 5 wrong current passwords", async () => {
    const ba = await actorFor("business_admin");
    for (let i = 0; i < 5; i++) expect((await changeOwnPassword(ba, { current: "nope nope nope", next: "a new long password" })).status).toBe("wrong_password");
    expect(await changeOwnPassword(ba, { current: PASSWORD, next: "a new long password" })).toEqual({ status: "rate_limited" });
  });

  it("can't sign out another user's session by id", async () => {
    const a = await actorFor("store_staff");
    const b = await createAccount("store_staff");
    const bSession = await sessionFor(b.id);
    expect(await revokeOwnSession(a, bSession)).toBe(false);
    expect(await activeSessions(b.id)).toBe(1);
    expect(await revokeOwnSession(a, a.sessionId)).toBe(false);
  });
});

describe("roles and permissions", () => {
  it("only Super Admins open the role screens", async () => {
    for (const level of ["business_admin", "store_staff"] as const) {
      const actor = await actorFor(level);
      await expect(listRoles(actor)).rejects.toBeInstanceOf(AuthzError);
      await expect(getRoleDetail(actor, await roleIdOf("store_staff"))).rejects.toBeInstanceOf(AuthzError);
      await expect(createRole(actor, { key: `test_r_${uid().toLowerCase()}`, name: "x", description: "", level: 3 })).rejects.toBeInstanceOf(AuthzError);
    }
    const sa = await actorFor("super_admin");
    const roles = await listRoles(sa);
    expect(roles.map((r) => r.key)).toEqual(expect.arrayContaining(["super_admin", "business_admin", "store_staff"]));
    expect(roles.some((r) => r.key === "customer")).toBe(false);
  });

  it("the Super Admin bundle and Super Admin-level roles can't be edited; system keys can't be reused", async () => {
    const sa = await actorFor("super_admin");
    expect((await getRoleDetail(sa, await roleIdOf("super_admin")))!.editable).toBe(false);
    expect(await setRolePermissions(sa, await roleIdOf("super_admin"), [])).toEqual({ status: "not_editable" });
    expect(await createRole(sa, { key: `test_r_${uid().toLowerCase()}`, name: "x", description: "", level: 1 })).toEqual({ status: "invalid", field: "invalid_level" });
    expect(await createRole(sa, { key: "store_staff", name: "x", description: "", level: 3 })).toEqual({ status: "taken" });
    expect(await updateRole(sa, await roleIdOf("store_staff"), { name: "Store Staff", description: "", isActive: false })).toMatchObject({ status: "ok" });
    const [staffRole] = await q<{ is_active: boolean }>("SELECT is_active FROM roles WHERE key = 'store_staff'");
    expect(staffRole!.is_active).toBe(true); // system roles stay active
  });

  it("grants only what the level allows and what the actor holds; untouchable cells keep their state", async () => {
    const sa = await actorFor("super_admin");
    const created = await createRole(sa, { key: `test_r_${uid().toLowerCase()}`, name: "TEST WAREHOUSE", description: "", level: 3 });
    if (created.status !== "ok") throw new Error(created.status);
    const grants = async () =>
      new Map(
        (
          await q<{ key: string; is_scoped: boolean }>(
            "SELECT p.key, rp.is_scoped FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1",
            [created.roleId],
          )
        ).map((r) => [r.key, r.is_scoped]),
      );

    // role.manage is above level 3's ceiling: silently not granted. Scoping a non-scopable permission is ignored.
    expect(
      await setRolePermissions(sa, created.roleId, [
        { key: "inventory.view", isScoped: true },
        { key: "role.manage", isScoped: false },
        { key: "brand.manage", isScoped: true },
        { key: "price.update.propose", isScoped: false },
      ]),
    ).toEqual({ status: "ok", roleId: created.roleId });
    expect(Object.fromEntries(await grants())).toEqual({ "inventory.view": true, "brand.manage": false, "price.update.propose": false });
    expect(await setRolePermissions(sa, created.roleId, [{ key: "no.such_permission", isScoped: false }])).toEqual({ status: "invalid", field: "unknown_permission" });

    // An actor missing a permission can neither grant nor remove it.
    const limited: Actor = { ...sa, permissions: new Map([...sa.permissions].filter(([k]) => k !== "brand.manage" && k !== "accounting.view")) };
    expect(await setRolePermissions(limited, created.roleId, [{ key: "accounting.view", isScoped: false }])).toMatchObject({ status: "ok" });
    const after = await grants();
    expect(after.has("brand.manage")).toBe(true); // kept, though not sent
    expect(after.has("accounting.view")).toBe(false); // not granted
    expect(after.has("inventory.view")).toBe(false); // removed: the limited actor holds it

    const audit = await q("SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'role.permissions_changed'", [created.roleId]);
    expect(audit.length).toBe(2);
  });

  it("a Super Admin can't edit a role they hold themselves", async () => {
    const sa = await actorFor("super_admin");
    const client = await pool.connect();
    await client.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'business_admin'", [sa.userId]);
    client.release();
    const detail = await getRoleDetail(sa, await roleIdOf("business_admin"));
    expect(detail!.isMember).toBe(true);
    expect(await setRolePermissions(sa, await roleIdOf("business_admin"), [])).toEqual({ status: "not_editable" });
  });

  it("role permission changes need a fresh two-factor check", async () => {
    const sa = await actorFor("super_admin", { mfaAgoMs: 10 * 60_000 });
    expect((await listRoles(sa)).length).toBeGreaterThan(0);
    await expect(setRolePermissions(sa, await roleIdOf("store_staff"), [])).rejects.toBeInstanceOf(MfaRequiredError);
  });
});

describe("audit view", () => {
  it("Business Admins read business and staff actions only; security events are Super Admin only", async () => {
    const ba = await actorFor("business_admin");
    const sa = await actorFor("super_admin");
    const staff = await actorFor("store_staff");
    await createAdminUser(ba, { username: `test-aud-${uid().toLowerCase()}`, email: "", name: "x", roleId: await roleIdOf("store_staff") });
    const business = await listAuditTrail(ba, {});
    expect(business.scope).toBe("business");
    expect(business.rows.length).toBeGreaterThan(0);
    expect(business.rows.every((r) => !r.action.startsWith("auth.") && !r.action.startsWith("admin.") && !r.action.startsWith("role."))).toBe(true);
    expect((await listAuditTrail(sa, { page: "1" })).scope).toBe("all");
    await expect(listAuditTrail(staff, {})).rejects.toBeInstanceOf(AuthzError);
    await expect(listSecurityLog(ba, {})).rejects.toBeInstanceOf(AuthzError);
    expect((await listSecurityLog(sa, { page: "999999" })).page).toBe(1);
  });
});

describe("admin phone numbers and customer sign-in", () => {
  const outbox: SmsMessage[] = [];
  beforeEach(() => {
    outbox.length = 0;
    setSmsSenderForTests({ name: "test", enabled: true, send: async (m) => (outbox.push(m), { ok: true }) });
  });
  afterAll(() => setSmsSenderForTests(undefined));

  it("an admin's verified phone number never gets a customer session", async () => {
    const local = `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    const admin = await createAccount("store_staff", { phone: `+98${local.slice(1)}` });
    const m = meta();
    expect((await requestPhoneOtp({ phone: local, renderText: (c) => `code ${c}` }, m)).status).toBe("sent");
    const code = outbox[0]!.text.replace("code ", "");
    expect(await verifyPhoneOtp({ phone: local, code }, m)).toEqual({ status: "account_disabled" });
    expect(await q("SELECT 1 FROM sessions WHERE user_id = $1 AND kind = 'customer'", [admin.id])).toHaveLength(0);
    expect(await q("SELECT 1 FROM security_events WHERE user_id = $1 AND type = 'otp.admin_phone_refused'", [admin.id])).toHaveLength(1);
  });
});
