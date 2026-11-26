import "server-only";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import { imageRenditions, releaseImage, storeImage, type UploadedFile } from "@/modules/media/service/images";
import type { Rendition } from "@/modules/media/domain/image-rules";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize } from "@/modules/rbac/service/authorize";
import {
  deleteProductImage,
  getProductImage,
  getProductDetail,
  insertProductImage,
  listProductImages,
  moveProductImage,
  productCategoryIds,
  setPrimaryProductImage,
  updateProductImageAlt,
  type ImageAlt,
} from "../repo/catalog-repo";
import { adminId, IS_UUID } from "./catalog-access";

/**
 * Product photos: upload (checked and re-encoded by the media module), alt
 * text in both languages, order, the main photo, and removal. Needs
 * product.update on all the product's categories, and media.upload to add.
 */

export type ImageResult = { status: "ok"; id: string } | { status: "not_found" } | { status: "invalid"; field: string };

export interface ProductImageView {
  id: string;
  alt: ImageAlt;
  isPrimary: boolean;
  renditions: Rendition[];
}

const altSchema = z.object({
  fa: z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "alt_fa_required").max(250, "invalid_alt")),
  en: z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().max(250, "invalid_alt")),
});

function toAlt(parsed: { fa: string; en: string }): ImageAlt {
  return parsed.en ? { fa: parsed.fa, en: parsed.en } : { fa: parsed.fa };
}

async function scopeFor(actor: Actor, productId: string, permission: string, stepUp = true): Promise<string[] | null> {
  if (!IS_UUID.test(productId)) return null;
  const categoryIds = await productCategoryIds(db(), productId);
  if (!categoryIds) return null;
  await authorize(actor, permission, { type: "product", id: productId, categoryIds }, { stepUp });
  return categoryIds;
}

export async function listProductImagesForAdmin(actor: Actor, productId: string): Promise<ProductImageView[]> {
  if (!(await scopeFor(actor, productId, "product.view", false))) return [];
  const rows = await listProductImages(db(), productId);
  return Promise.all(rows.map(async (r) => ({ id: r.id, alt: r.alt, isPrimary: r.isPrimary, renditions: await imageRenditions(r.mediaId) })));
}

export async function addProductImage(actor: Actor, productId: string, file: UploadedFile, altInput: { fa: string; en: string }): Promise<ImageResult> {
  const userId = adminId(actor, "product.update");
  const categoryIds = await scopeFor(actor, productId, "product.update");
  if (!categoryIds) return { status: "not_found" };
  const product = await getProductDetail(db(), productId);
  if (!product) return { status: "not_found" };
  // Alt text defaults to the product's name.
  const title = (locale: string) => product.translations.find((t) => t.locale === locale)?.title ?? "";
  const alt = altSchema.safeParse({ fa: altInput.fa || title("fa"), en: altInput.en || title("en") });
  if (!alt.success) return { status: "invalid", field: alt.error.issues[0]?.message ?? "invalid_alt" };

  const stored = await storeImage(actor, file, { categoryIds });
  if (stored.status !== "ok") return stored;
  try {
    const id = await transaction(async (tx) => {
      const id = await insertProductImage(tx, productId, stored.mediaId, toAlt(alt.data));
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action: "product.image_added",
        entityType: "product",
        entityId: productId,
        after: { imageId: id, mediaId: stored.mediaId },
      });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    await releaseImage(stored.mediaId);
    throw error;
  }
}

async function loadImage(actor: Actor, productId: string, imageId: string) {
  if (!IS_UUID.test(imageId)) return null;
  if (!(await scopeFor(actor, productId, "product.update"))) return null;
  return getProductImage(db(), productId, imageId);
}

export async function updateProductImage(actor: Actor, productId: string, imageId: string, altInput: { fa: string; en: string }): Promise<ImageResult> {
  const userId = adminId(actor, "product.update");
  const image = await loadImage(actor, productId, imageId);
  if (!image) return { status: "not_found" };
  const alt = altSchema.safeParse(altInput);
  if (!alt.success) return { status: "invalid", field: alt.error.issues[0]?.message ?? "invalid_alt" };
  await transaction(async (tx) => {
    await updateProductImageAlt(tx, imageId, toAlt(alt.data));
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "product.image_updated",
      entityType: "product",
      entityId: productId,
      before: { imageId, alt: image.alt },
      after: { imageId, alt: toAlt(alt.data) },
    });
  });
  return { status: "ok", id: imageId };
}

export async function makePrimaryProductImage(actor: Actor, productId: string, imageId: string): Promise<ImageResult> {
  const userId = adminId(actor, "product.update");
  const image = await loadImage(actor, productId, imageId);
  if (!image) return { status: "not_found" };
  await transaction(async (tx) => {
    await setPrimaryProductImage(tx, productId, imageId);
    await recordAudit(tx, actor.meta, { actorUserId: userId, action: "product.image_primary", entityType: "product", entityId: productId, after: { imageId } });
  });
  return { status: "ok", id: imageId };
}

export async function reorderProductImage(actor: Actor, productId: string, imageId: string, direction: string): Promise<ImageResult> {
  const userId = adminId(actor, "product.update");
  if (direction !== "up" && direction !== "down") return { status: "invalid", field: "invalid" };
  const image = await loadImage(actor, productId, imageId);
  if (!image) return { status: "not_found" };
  await transaction(async (tx) => {
    if (await moveProductImage(tx, productId, imageId, direction)) {
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "product.image_moved", entityType: "product", entityId: productId, after: { imageId, direction } });
    }
  });
  return { status: "ok", id: imageId };
}

export async function removeProductImage(actor: Actor, productId: string, imageId: string): Promise<ImageResult> {
  const userId = adminId(actor, "product.update");
  const image = await loadImage(actor, productId, imageId);
  if (!image) return { status: "not_found" };
  const mediaId = await transaction(async (tx) => {
    const mediaId = await deleteProductImage(tx, productId, imageId);
    if (mediaId) {
      await recordAudit(tx, actor.meta, { actorUserId: userId, action: "product.image_removed", entityType: "product", entityId: productId, before: { imageId, mediaId } });
    }
    return mediaId;
  });
  if (!mediaId) return { status: "not_found" };
  await releaseImage(mediaId);
  return { status: "ok", id: imageId };
}
