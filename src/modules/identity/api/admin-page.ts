import "server-only";
import { forbidden } from "next/navigation";
import { redirect } from "@/lib/i18n/navigation";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError, MfaRequiredError } from "@/modules/rbac/service/authorize";
import type { AdminContext } from "../service/admin-auth";
import { requireAdmin } from "./admin-guard";

/**
 * For admin pages: signs in (or redirects), runs the page's service call and
 * turns a denial into the 403 page and a step-up need into the two-factor
 * page. The service does the actual authorization.
 */
export async function adminPage<T>(
  locale: string,
  load: (actor: Actor, ctx: AdminContext) => Promise<T>,
  returnPath = "/admin",
): Promise<{ data: T; actor: Actor; ctx: AdminContext }> {
  const { actor, ctx } = await requireAdmin(locale);
  let data: T;
  try {
    data = await load(actor, ctx);
  } catch (error) {
    if (error instanceof AuthzError) forbidden();
    if (error instanceof MfaRequiredError) redirect({ href: `/admin/mfa?next=${encodeURIComponent(returnPath)}`, locale });
    throw error;
  }
  return { data, actor, ctx };
}
