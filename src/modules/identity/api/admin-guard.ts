import "server-only";
import { cache } from "react";
import { currentRequestMeta } from "@/lib/http/server";
import { redirect } from "@/lib/i18n/navigation";
import type { Actor } from "@/modules/rbac/domain/actor";
import { adminActor, getAdminContext, type AdminContext } from "../service/admin-auth";
import { readSessionToken } from "./cookies";

/** The admin behind this request's cookie (memoized for the request). */
export const currentAdmin = cache(async (): Promise<AdminContext | null> => {
  return getAdminContext(await readSessionToken("admin"));
});

/**
 * For admin pages and actions: returns the admin and their Actor, or
 * redirects to sign-in / the TOTP step. Pages still call services, which
 * authorize() each action; this guard only decides who may see the shell.
 */
export async function requireAdmin(locale: string): Promise<{ ctx: AdminContext; actor: Actor }> {
  const ctx = await currentAdmin();
  if (!ctx) redirect({ href: "/admin/login", locale });
  if (ctx!.mfa === "challenge") redirect({ href: "/admin/mfa", locale });
  if (ctx!.mfa === "setup") redirect({ href: "/admin/mfa/setup", locale });
  return { ctx: ctx!, actor: adminActor(ctx!, await currentRequestMeta()) };
}
