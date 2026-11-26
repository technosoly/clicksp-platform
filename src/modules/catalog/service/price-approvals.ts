import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import {
  decideApprovalRow,
  finishApprovalRow,
  getApproval,
  getVariant,
  listPriceApprovals,
  PRICE_APPROVAL_ACTION,
  productCategoryIds,
  setTransactionActor,
  setVariantPriceRow,
} from "../repo/catalog-repo";
import { adminId, allowedCategories, IS_UUID } from "./catalog-access";

/**
 * Price change requests (Store Staff with price.update.propose) and their
 * review by admins holding price.update for the product's categories. The
 * requester can never decide their own request (also a database CHECK); a
 * decision is final (database trigger). An approved change runs at once in
 * the same transaction, and fails instead if the price moved since the
 * request was made.
 */

export type ApprovalResult =
  | { status: "ok"; outcome: "executed" | "failed" | "rejected" | "cancelled" }
  | { status: "not_found" }
  | { status: "self" }
  | { status: "already_decided" }
  | { status: "expired" }
  | { status: "invalid"; field: string };

/** Requests waiting for this reviewer (pending) or already decided. */
export async function listApprovalInbox(actor: Actor, view: "pending" | "decided", now = new Date()) {
  const allowed = await allowedCategories(actor, "price.update");
  return listPriceApprovals(db(), { status: view, requestedById: null, allowedCategoryIds: allowed, now });
}

/** The actor's own requests (Store Staff). */
export async function listOwnApprovalRequests(actor: Actor, now = new Date()) {
  const userId = adminId(actor, "price.update.propose");
  if (!actor.permissions.has("price.update.propose")) await authorize(actor, "price.update.propose", undefined, { stepUp: false });
  const [pending, decided] = await Promise.all([
    listPriceApprovals(db(), { status: "pending", requestedById: userId, allowedCategoryIds: null, now }),
    listPriceApprovals(db(), { status: "decided", requestedById: userId, allowedCategoryIds: null, now }),
  ]);
  return [...pending, ...decided];
}

async function loadRequest(approvalId: string) {
  if (!IS_UUID.test(approvalId)) return null;
  const approval = await getApproval(db(), approvalId);
  if (!approval || approval.action !== PRICE_APPROVAL_ACTION || !approval.entityId) return null;
  const variant = await getVariant(db(), approval.entityId);
  if (!variant) return null;
  const categoryIds = await productCategoryIds(db(), variant.productId);
  if (!categoryIds) return null;
  return { approval, variant, categoryIds };
}

export async function decidePriceRequest(
  actor: Actor,
  approvalId: string,
  decision: "approve" | "reject",
  noteInput: string,
  now = new Date(),
): Promise<ApprovalResult> {
  const userId = adminId(actor, "price.update");
  const loaded = await loadRequest(approvalId);
  if (!loaded) {
    await allowedCategories(actor, "price.update");
    return { status: "not_found" };
  }
  const { approval, variant, categoryIds } = loaded;
  await authorize(actor, "price.update", { type: "admin_approval", id: approvalId, categoryIds });
  if (approval.requestedById === userId) return { status: "self" };
  if (approval.status !== "pending") return { status: "already_decided" };
  const note = noteInput.replace(/\s+/g, " ").trim().slice(0, 1000) || null;

  if (approval.expiresAt <= now) {
    await transaction(async (tx) => {
      if (await decideApprovalRow(tx, approvalId, { status: "expired", decidedById: null, note: null, at: now })) {
        await recordAudit(tx, actor.meta, { actorUserId: userId, action: "price.request_expired", entityType: "admin_approval", entityId: approvalId });
      }
    });
    return { status: "expired" };
  }

  if (decision === "reject") {
    const ok = await transaction(async (tx) => {
      if (!(await decideApprovalRow(tx, approvalId, { status: "rejected", decidedById: userId, note, at: now }))) return false;
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "price.request_rejected", entityType: "admin_approval", entityId: approvalId, after: { note } });
      return true;
    });
    return ok ? { status: "ok", outcome: "rejected" } : { status: "already_decided" };
  }

  const payload = approval.payload;
  const outcome = await transaction(async (tx) => {
    if (!(await decideApprovalRow(tx, approvalId, { status: "approved", decidedById: userId, note, at: now }))) return "already_decided" as const;
    const stillCurrent =
      variant.price.toString() === payload.previousPrice && (variant.compareAtPrice?.toString() ?? null) === payload.previousCompareAtPrice;
    if (!stillCurrent) {
      await finishApprovalRow(tx, approvalId, { status: "failed", error: "price_changed_since_request", at: now });
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "price.request_failed",
        entityType: "admin_approval",
        entityId: approvalId,
        after: { reason: "price_changed_since_request", currentPrice: variant.price.toString() },
      });
      return "failed" as const;
    }
    await setTransactionActor(tx, userId, approvalId);
    await setVariantPriceRow(tx, variant.id, BigInt(payload.price), payload.compareAtPrice === null ? null : BigInt(payload.compareAtPrice));
    await finishApprovalRow(tx, approvalId, { status: "executed", error: null, at: now });
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "price.request_approved",
      entityType: "product_variant",
      entityId: variant.id,
      before: { price: payload.previousPrice, compareAtPrice: payload.previousCompareAtPrice },
      after: { price: payload.price, compareAtPrice: payload.compareAtPrice, approvalId, requestedBy: approval.requestedById, note },
    });
    return "executed" as const;
  });
  return outcome === "already_decided" ? { status: "already_decided" } : { status: "ok", outcome };
}

/** The requester withdraws their own pending request. */
export async function cancelOwnPriceRequest(actor: Actor, approvalId: string, now = new Date()): Promise<ApprovalResult> {
  const userId = adminId(actor, "price.update.propose");
  const loaded = await loadRequest(approvalId);
  if (!loaded || loaded.approval.requestedById !== userId) {
    await allowedCategories(actor, "price.update.propose");
    return { status: "not_found" };
  }
  await authorize(actor, "price.update.propose", { type: "admin_approval", id: approvalId, categoryIds: loaded.categoryIds });
  const ok = await transaction(async (tx) => {
    if (!(await decideApprovalRow(tx, approvalId, { status: "cancelled", decidedById: null, note: null, at: now }))) return false;
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "price.request_cancelled", entityType: "admin_approval", entityId: approvalId });
    return true;
  });
  return ok ? { status: "ok", outcome: "cancelled" } : { status: "already_decided" };
}
