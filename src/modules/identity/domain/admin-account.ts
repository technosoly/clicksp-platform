/**
 * Rules for admin accounts managed from the admin panel (Phase 5): input
 * validation, password link lifetimes, audit action names and the safe
 * "return to" path after a two-factor check. Pure, no I/O.
 */
import { z } from "zod";
import { toEnDigits } from "@/lib/persian-text";

/** Matches the users_username_format CHECK in the database. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/;

const username = z
  .string()
  .transform((v) => toEnDigits(v.normalize("NFKC")).trim().toLowerCase())
  .pipe(z.string().regex(USERNAME_PATTERN, "invalid_username"));

const email = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.union([z.literal(""), z.string().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "invalid_email")]))
  .transform((v) => (v === "" ? null : v));

const name = z
  .string()
  .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "invalid_name").max(120, "invalid_name"));

const uuid = z.uuid("invalid_role");

export const createAdminUserSchema = z.object({ username, email, name, roleId: uuid });
export type CreateAdminUserInput = z.input<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z.object({ email, name });
export type UpdateAdminUserInput = z.input<typeof updateAdminUserSchema>;

/** The first validation message of a failed parse, as a translation key. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid";
}

/** "Set your password" link for a new admin. Handed over in person, so it lives longer. */
export const INVITE_TTL_HOURS = 72;
/** Password reset link, issued by a manager or by the server CLI. */
export const RESET_TTL_MINUTES = 30;
/** Wrong or expired link submissions per IP address in the window. */
export const RESET_MAX_INVALID_PER_IP = 20;
export const RESET_WINDOW_MINUTES = 15;

export type PasswordLinkPurpose = "admin_invite" | "password_reset";

export function passwordLinkExpiry(purpose: PasswordLinkPurpose, now: Date): Date {
  const ms = purpose === "admin_invite" ? INVITE_TTL_HOURS * 3_600_000 : RESET_TTL_MINUTES * 60_000;
  return new Date(now.getTime() + ms);
}

/**
 * Audit action prefix for changes to an admin account: Store Staff accounts
 * are business records (visible with audit.view_business), changes to Super
 * and Business Admins are technical (audit.view_all only).
 */
export function accountAuditAction(targetLevel: number, verb: string): string {
  return `${targetLevel === 3 ? "staff" : "admin"}.${verb}`;
}

/**
 * Where to go after a two-factor check: only admin paths of this site, never
 * another origin ("//evil", "/\\evil", "https://...") or a non-admin page.
 * The locale prefix is added by the router, so the path starts at /admin.
 */
export function safeAdminReturnPath(input: unknown): string {
  if (typeof input !== "string") return "/admin";
  return /^\/admin(?:\/[a-z0-9-]+)*(?:\?[a-z0-9=&_-]*)?$/.test(input) && !input.includes("//") ? input : "/admin";
}

/** Shapes a password link token for the URL fragment (never sent to the server in requests or logs). */
export function passwordLinkPath(locale: string, token: string): string {
  return `/${locale}/admin/set-password#${token}`;
}
