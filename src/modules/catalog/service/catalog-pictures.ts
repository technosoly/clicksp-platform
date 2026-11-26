import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import { releaseImage, storeImage, type UploadedFile } from "@/modules/media/service/images";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import { getBrand, getCategory, setBrandLogoRow, setCategoryImageRow } from "../repo/catalog-repo";
import { adminId, IS_UUID } from "./catalog-access";

/**
 * Brand logos (brand.manage) and category pictures (category.manage on that
 * category); uploading also needs media.upload. Replacing or removing a
 * picture deletes the old file once nothing uses it.
 */

export type PictureResult = { status: "ok" } | { status: "not_found" } | { status: "invalid"; field: string };

async function swap(
  actor: Actor,
  target: { kind: "brand" | "category"; id: string },
  file: UploadedFile | null,
  categoryIds: string[] | undefined,
): Promise<PictureResult> {
  const userId = adminId(actor, target.kind === "brand" ? "brand.manage" : "category.manage");
  let mediaId: string | null = null;
  if (file) {
    // A brand belongs to no category: scoped uploaders (Store Staff) can't set logos.
    const stored = await storeImage(actor, file, { categoryIds: categoryIds ?? [] });
    if (stored.status !== "ok") return stored;
    mediaId = stored.mediaId;
  }
  let previous: string | null;
  try {
    previous = await transaction(async (tx) => {
      const before = target.kind === "brand" ? await setBrandLogoRow(tx, target.id, mediaId) : await setCategoryImageRow(tx, target.id, mediaId);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: target.kind === "brand" ? "brand.logo_changed" : "category.image_changed",
        entityType: target.kind,
        entityId: target.id,
        before: { mediaId: before },
        after: { mediaId },
      });
      return before;
    });
  } catch (error) {
    if (mediaId) await releaseImage(mediaId);
    throw error;
  }
  if (previous && previous !== mediaId) await releaseImage(previous);
  return { status: "ok" };
}

export async function setBrandLogo(actor: Actor, brandId: string, file: UploadedFile | null): Promise<PictureResult> {
  if (!IS_UUID.test(brandId)) return { status: "not_found" };
  await authorize(actor, "brand.manage", { type: "brand", id: brandId });
  if (!(await getBrand(db(), brandId))) return { status: "not_found" };
  return swap(actor, { kind: "brand", id: brandId }, file, undefined);
}

export async function setCategoryImage(actor: Actor, categoryId: string, file: UploadedFile | null): Promise<PictureResult> {
  if (!IS_UUID.test(categoryId)) return { status: "not_found" };
  await authorize(actor, "category.manage", { type: "category", id: categoryId, categoryIds: [categoryId] });
  if (!(await getCategory(db(), categoryId))) return { status: "not_found" };
  return swap(actor, { kind: "category", id: categoryId }, file, [categoryId]);
}
