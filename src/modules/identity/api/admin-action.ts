import "server-only";
import { refresh } from "next/cache";
import { isLocale } from "@/lib/i18n/config";
import { logger } from "@/lib/logger";
import type { Actor } from "@/modules/rbac/domain/actor";
import { AuthzError, MfaRequiredError } from "@/modules/rbac/service/authorize";
import { requireAdmin } from "./admin-guard";

/** What admin forms get back from a Server Action. */
export interface ActionState {
  ok?: boolean;
  /** Translation key under AdminPeople.errors / AdminAccount.errors. */
  error?: string;
  /** One-time password link, shown once after create / reset. */
  link?: string;
  expiresAt?: string;
  /** Translation key of a success message. */
  message?: string;
  /** New backup codes, shown once. */
  backupCodes?: string[];
  /** Interpolation values for the error or message. */
  values?: Record<string, number>;
}

export function localeOf(form: FormData): "fa" | "en" {
  const value = form.get("locale");
  return isLocale(value) ? value : "fa";
}

export function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Runs an admin Server Action: resolves the signed-in admin from the cookie
 * (redirecting to sign-in when there is none) and turns authorization errors
 * into form errors. "mfa_required" makes the form offer a two-factor check.
 * The services authorize every action themselves; this is only glue.
 */
export async function runAdminAction(form: FormData, fn: (actor: Actor) => Promise<ActionState>): Promise<ActionState> {
  const { actor } = await requireAdmin(localeOf(form));
  try {
    const state = await fn(actor);
    // Re-render the current page so it shows the change (badges, lists).
    if (state.ok) refresh();
    return state;
  } catch (error) {
    if (error instanceof MfaRequiredError) return { error: "mfa_required" };
    if (error instanceof AuthzError) return { error: "forbidden" };
    logger.error("admin action failed", { error: String(error) });
    return { error: "unexpected" };
  }
}
