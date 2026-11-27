import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { availableAdapterKeys } from "../adapters/registry";
import { listProviders, orderPayments, setProviderActive } from "../repo/payment-repo";

/**
 * Payment settings in the admin. Seeing them needs payment_provider.view
 * (Super and Business Admin); switching a gateway on or off needs
 * payment_provider.configure (Super Admin, fresh MFA) and is audited.
 * Credentials never pass through here: they live in the server environment.
 */

function adminId(actor: Actor, key: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(key, "not_admin");
  return actor.userId;
}

export async function gatewaysForAdmin(actor: Actor) {
  adminId(actor, "payment_provider.view");
  await authorize(actor, "payment_provider.view");
  const rows = await listProviders(db());
  const available = availableAdapterKeys();
  const keys = [...new Set([...available, ...rows.map((r) => r.adapterKey)])].sort();
  return {
    gateways: keys.map((key) => {
      const row = rows.find((r) => r.code === key);
      return { key, available: available.includes(key), isActive: row?.isActive ?? false, isSandbox: row?.isSandbox ?? key === "fake" };
    }),
    canConfigure: actor.permissions.has("payment_provider.configure"),
  };
}

export type GatewayResult = { status: "ok" } | { status: "not_found" };

export async function setGatewayActive(actor: Actor, key: string, isActive: boolean): Promise<GatewayResult> {
  const userId = adminId(actor, "payment_provider.configure");
  await authorize(actor, "payment_provider.configure");
  // Only a gateway this server can use may be switched on; any known one may be switched off.
  if (isActive && !availableAdapterKeys().includes(key)) return { status: "not_found" };
  if (!isActive && !(await listProviders(db())).some((r) => r.code === key)) return { status: "not_found" };
  await transaction(async (tx) => {
    const { id, before } = await setProviderActive(tx, key, isActive);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: isActive ? "payment_provider.activated" : "payment_provider.deactivated", entityType: "payment_provider", entityId: id, before: before ?? undefined, after: { code: key, isActive } });
  });
  return { status: "ok" };
}

/** The payments of an order, for admins who may see payment data (null for others). */
export async function orderPaymentsForAdmin(actor: Actor, orderId: string) {
  adminId(actor, "order.view_payment");
  if (!actor.permissions.has("order.view_payment")) return null;
  await authorize(actor, "order.view_payment");
  return orderPayments(db(), orderId);
}
