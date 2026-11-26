import { describe, expect, it } from "vitest";
import {
  accountAuditAction,
  createAdminUserSchema,
  passwordLinkExpiry,
  passwordLinkPath,
  safeAdminReturnPath,
} from "../domain/admin-account";

const role = "0190b1a2-0000-7000-8000-000000000000";

describe("admin account input", () => {
  it("normalizes username (case, spaces, Persian digits) and empty email", () => {
    const parsed = createAdminUserSchema.parse({ username: " Ali.Store۱ ", email: "  ", name: "  Ali   Rezaei ", roleId: role });
    expect(parsed).toEqual({ username: "ali.store1", email: null, name: "Ali Rezaei", roleId: role });
  });

  it("rejects bad usernames, emails, names and role ids", () => {
    const bad = [
      { username: "ab", email: "", name: "x", roleId: role },
      { username: "-abc", email: "", name: "x", roleId: role },
      { username: "علی", email: "", name: "x", roleId: role },
      { username: "valid", email: "not-an-email", name: "x", roleId: role },
      { username: "valid", email: "", name: "   ", roleId: role },
      { username: "valid", email: "", name: "x", roleId: "1; DROP TABLE users" },
    ];
    for (const input of bad) expect(createAdminUserSchema.safeParse(input).success).toBe(false);
  });
});

describe("password links", () => {
  it("invitations last 72 hours, resets 30 minutes", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(passwordLinkExpiry("admin_invite", now).toISOString()).toBe("2026-11-30T10:00:00.000Z");
    expect(passwordLinkExpiry("password_reset", now).toISOString()).toBe("2026-11-27T10:30:00.000Z");
  });

  it("puts the token in the URL fragment", () => {
    expect(passwordLinkPath("fa", "abc")).toBe("/fa/admin/set-password#abc");
  });
});

describe("audit action names", () => {
  it("separates staff accounts (business) from admin accounts (technical)", () => {
    expect(accountAuditAction(3, "created")).toBe("staff.created");
    expect(accountAuditAction(2, "created")).toBe("admin.created");
    expect(accountAuditAction(1, "disabled")).toBe("admin.disabled");
  });
});

describe("safeAdminReturnPath", () => {
  it.each([
    ["/admin/people/users/0190b1a2-0000-7000-8000-000000000000", "/admin/people/users/0190b1a2-0000-7000-8000-000000000000"],
    ["/admin/audit?tab=security&page=2", "/admin/audit?tab=security&page=2"],
    ["/admin", "/admin"],
  ])("keeps %s", (input, expected) => expect(safeAdminReturnPath(input)).toBe(expected));

  it.each(["//evil.example", "https://evil.example/admin", "/admin//evil.example", "/\\evil", "/fa/account", "/administrator", "/admin/../account", "/admin?x=<script>", null, 42])(
    "refuses %s",
    (input) => expect(safeAdminReturnPath(input)).toBe("/admin"),
  );
});
