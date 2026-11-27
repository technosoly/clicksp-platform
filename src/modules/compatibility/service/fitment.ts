import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import { productCategoriesForAuthorization } from "@/modules/catalog/service/products";
import type { Actor } from "@/modules/rbac/domain/actor";
import { decide } from "@/modules/rbac/domain/authorize";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { DECISIONS, fitmentInputSchema, newSourceSchema, type FitmentInput, type VerificationStatusKey } from "../domain/fitment-input";
import {
  deleteFitment,
  lockFitmentStatus,
  generationExists,
  getFitment,
  insertFitment,
  insertSource,
  listFitment,
  listSources,
  setFitmentStatus,
  sourceExists,
  variantExists,
} from "../repo/fitment-repo";

/**
 * Which motorcycles a part fits. Links are never inferred: each one names a
 * motorcycle (a variant, or a whole generation within years) and cites a
 * source. New links are unverified; only holders of compatibility.verify
 * verify, dispute or reject them, and the shop shows verified links only.
 * Managing links needs compatibility.manage on all the product's categories.
 */

export type FitmentResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string } | { status: "duplicate" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminId(actor: Actor, permission: string): string {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError(permission, "not_admin");
  return actor.userId;
}

async function productScope(actor: Actor, productId: string, permission: string, stepUp = true): Promise<string[] | null> {
  if (!UUID.test(productId)) return null;
  const categoryIds = await productCategoriesForAuthorization(productId);
  if (!categoryIds) return null;
  await authorize(actor, permission, { type: "product", id: productId, categoryIds }, { stepUp });
  return categoryIds;
}

export async function fitmentForAdmin(actor: Actor, productId: string) {
  adminId(actor, "product.view");
  const categoryIds = await productScope(actor, productId, "product.view", false);
  if (!categoryIds) return null;
  const can = {
    manage: decide(actor.permissions, "compatibility.manage", { categoryIds }).allowed,
    verify: decide(actor.permissions, "compatibility.verify", { categoryIds }).allowed,
  };
  return { links: await listFitment(db(), productId), sources: can.manage ? await listSources(db()) : [], can };
}

export async function addFitment(
  actor: Actor,
  productId: string,
  input: FitmentInput,
  newSource: { type: string; title: string; reference: string; url: string },
): Promise<FitmentResult> {
  const userId = adminId(actor, "compatibility.manage");
  if (!(await productScope(actor, productId, "compatibility.manage"))) return { status: "not_found" };
  const parsed = fitmentInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", field: parsed.error.issues[0]?.message ?? "invalid" };
  const data = parsed.data;
  const targetOk = "variantId" in data.target ? await variantExists(db(), data.target.variantId) : await generationExists(db(), data.target.generationId);
  if (!targetOk) return { status: "invalid", field: "motorcycle_required" };

  // A link always cites a source: an existing one, or one described here.
  let source: { id: string } | { create: ReturnType<typeof newSourceSchema.parse> };
  if (data.sourceId) {
    if (!(await sourceExists(db(), data.sourceId))) return { status: "invalid", field: "invalid_source" };
    source = { id: data.sourceId };
  } else {
    if (!newSource.title.trim()) return { status: "invalid", field: "source_required" };
    const parsedSource = newSourceSchema.safeParse(newSource);
    if (!parsedSource.success) return { status: "invalid", field: parsedSource.error.issues[0]?.message ?? "invalid" };
    source = { create: parsedSource.data };
  }

  try {
    const id = await transaction(async (tx) => {
      const sourceId = "id" in source ? source.id : await insertSource(tx, source.create, userId);
      const id = await insertFitment(tx, productId, data, sourceId, userId);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "fitment.created",
        entityType: "product_compatibility",
        entityId: id,
        after: { productId, ...data.target, yearFrom: data.yearFrom, yearTo: data.yearTo, position: data.position, sourceId, newSource: "create" in source },
      });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint") || message.includes("P2002")) return { status: "duplicate" };
    if (message.includes("outside the motorcycle variant")) return { status: "invalid", field: "years_outside_variant" };
    if (message.includes("outside the motorcycle generation")) return { status: "invalid", field: "years_outside_generation" };
    throw error;
  }
}

/** Verify, dispute, reject, or send back to unverified (compatibility.verify). */
export async function decideFitment(actor: Actor, productId: string, linkId: string, statusInput: string, now = new Date()): Promise<FitmentResult> {
  const userId = adminId(actor, "compatibility.verify");
  const status = DECISIONS.find((d) => d === statusInput) as VerificationStatusKey | undefined;
  if (!status) return { status: "invalid", field: "invalid_status" };
  if (!(await productScope(actor, productId, "compatibility.verify"))) return { status: "not_found" };
  const link = UUID.test(linkId) ? await getFitment(db(), productId, linkId) : null;
  if (!link) return { status: "not_found" };
  await transaction(async (tx) => {
    await setFitmentStatus(tx, linkId, status, userId, now);
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: `fitment.${status}`,
      entityType: "product_compatibility",
      entityId: linkId,
      before: { status: link.verificationStatus },
      after: { status },
    });
  });
  return { status: "ok", id: linkId };
}

/** Removes a link. A verified link can be removed only by a verifier. */
export async function removeFitment(actor: Actor, productId: string, linkId: string): Promise<FitmentResult> {
  const userId = adminId(actor, "compatibility.manage");
  const categoryIds = await productScope(actor, productId, "compatibility.manage");
  if (!categoryIds) return { status: "not_found" };
  const link = UUID.test(linkId) ? await getFitment(db(), productId, linkId) : null;
  if (!link) return { status: "not_found" };
  // The status is re-read under a row lock: a link verified after the first
  // read can still be removed only by a verifier.
  const run = (mayRemoveVerified: boolean) =>
    transaction(async (tx) => {
      const status = await lockFitmentStatus(tx, productId, linkId);
      if (status === null) return "gone" as const;
      if (status === "verified" && !mayRemoveVerified) return "needs_verify" as const;
      await deleteFitment(tx, productId, linkId);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "fitment.removed",
        entityType: "product_compatibility",
        entityId: linkId,
        before: { productId, status, sourceId: link.sourceId },
      });
      return "removed" as const;
    });
  let outcome = await run(false);
  if (outcome === "needs_verify") {
    await authorize(actor, "compatibility.verify", { type: "product", id: productId, categoryIds });
    outcome = await run(true);
  }
  const removed = outcome === "removed";
  return removed ? { status: "ok", id: linkId } : { status: "not_found" };
}
