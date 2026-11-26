import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/modules/rbac/domain/actor";
import { holds } from "@/modules/rbac/domain/authorize";
import { authorize } from "@/modules/rbac/service/authorize";
import { listAuditLogs, listSecurityEvents } from "../repo/audit-repo";

/**
 * Audit actions a Business Admin may read with audit.view_business: business
 * records and Store Staff account changes. Sign-ins, roles, Super/Business
 * Admin accounts and technical settings need audit.view_all (Super Admin).
 */
export const BUSINESS_AUDIT_PREFIXES: readonly string[] = [
  "staff.",
  "product.",
  "price.",
  "category.",
  "brand.",
  "vehicle.",
  "compatibility.",
  "inventory.",
  "order.",
  "return.",
  "refund.",
  "customer.",
  "accounting.",
  "expense.",
  "income.",
  "shipping.",
  "article.",
  "content.",
  "menu.",
  "banner.",
  "settings.store.",
];

export const AUDIT_PAGE_SIZE = 50;

function pageOf(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** The audit trail the actor may read: everything (view_all) or business actions (view_business). */
export async function listAuditTrail(actor: Actor, input: { page?: unknown }) {
  const all = holds(actor.permissions, "audit.view_all");
  await authorize(actor, all ? "audit.view_all" : "audit.view_business");
  const page = pageOf(input.page);
  const result = await listAuditLogs(db(), { actionPrefixes: all ? null : BUSINESS_AUDIT_PREFIXES, page, pageSize: AUDIT_PAGE_SIZE });
  return { ...result, page, pageSize: AUDIT_PAGE_SIZE, scope: all ? ("all" as const) : ("business" as const) };
}

/** Denied access, rate limits, failed two-factor codes: Super Admin only. */
export async function listSecurityLog(actor: Actor, input: { page?: unknown }) {
  await authorize(actor, "audit.view_all");
  const page = pageOf(input.page);
  const result = await listSecurityEvents(db(), { page, pageSize: AUDIT_PAGE_SIZE });
  return { ...result, page, pageSize: AUDIT_PAGE_SIZE };
}
