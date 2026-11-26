import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { db, transaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import {
  IMAGE_KEY_PATTERN,
  imageKey,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_SIDE,
  precheckImage,
  renditionWidths,
  type ImageProblem,
  type Rendition,
} from "../domain/image-rules";
import { getImageRow, imageUseCount, insertImageRow, isServableKey, softDeleteImageRow } from "../repo/media-repo";
import { objectStorage } from "../storage/object-storage";

/**
 * Uploaded images. Every upload is checked by its bytes, fully decoded and
 * re-encoded to WebP at a few widths (which drops EXIF/GPS data and anything
 * hidden in the file), and only the re-encoded files are stored and served.
 * Callers that attach the image to something (a product, a brand) pass the
 * categories it belongs to, so a scoped Store Staff member can upload only
 * inside their categories.
 */

export type StoreImageResult = { status: "ok"; mediaId: string } | { status: "invalid"; field: ImageProblem };

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

async function encode(bytes: Uint8Array): Promise<{ width: number; height: number; outputs: { width: number; height: number; data: Buffer }[] } | ImageProblem> {
  let base: Sharp;
  let width: number;
  let height: number;
  try {
    // rotate() applies the EXIF orientation; metadata is not copied to the output.
    base = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false }).rotate();
    const meta = await base.metadata();
    if (!meta.width || !meta.height) return "image_type";
    // Orientations 5-8 swap width and height once rotated.
    const swapped = (meta.orientation ?? 1) >= 5;
    width = swapped ? meta.height : meta.width;
    height = swapped ? meta.width : meta.height;
  } catch {
    return "image_type";
  }
  if (Math.min(width, height) < MIN_IMAGE_SIDE) return "image_too_small";
  const outputs = [];
  try {
    // Encoding decodes the whole file: a broken or truncated image fails here.
    for (const w of renditionWidths(width)) {
      const { data, info } = await base
        .clone()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      outputs.push({ width: info.width, height: info.height, data });
    }
  } catch {
    return "image_type";
  }
  return { width, height, outputs };
}

/** Checks, re-encodes and stores an image; returns its media id. */
export async function storeImage(actor: Actor, file: UploadedFile, scope: { categoryIds: string[] }, now = new Date()): Promise<StoreImageResult> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("media.upload", "not_admin");
  await authorize(actor, "media.upload", { type: "media", categoryIds: scope.categoryIds });
  const problem = precheckImage(file.bytes);
  if (problem) return { status: "invalid", field: problem };
  const encoded = await encode(file.bytes);
  if (typeof encoded === "string") return { status: "invalid", field: encoded };

  const mediaId = randomUUID();
  const storage = objectStorage();
  const renditions: Rendition[] = [];
  try {
    for (const out of encoded.outputs) {
      const key = imageKey(mediaId, out.width, now);
      await storage.put(key, out.data, "image/webp");
      renditions.push({ key, width: out.width, height: out.height, bytes: out.data.length });
    }
    const largest = renditions[renditions.length - 1]!;
    await transaction((tx) =>
      insertImageRow(tx, {
        id: mediaId,
        storageKey: largest.key,
        bucket: storage.name,
        originalFilename: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 200) || "image",
        sizeBytes: largest.bytes,
        width: largest.width,
        height: largest.height,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        renditions,
        uploadedById: actor.userId!,
      }),
    );
  } catch (error) {
    await removeFiles(renditions);
    throw error;
  }
  return { status: "ok", mediaId };
}

async function removeFiles(renditions: readonly Rendition[]): Promise<void> {
  const storage = objectStorage();
  for (const r of renditions) {
    try {
      await storage.delete(r.key);
    } catch (error) {
      logger.warn("media file not removed", { key: r.key, error: String(error) });
    }
  }
}

/**
 * Deletes an image once nothing uses it any more (call after the record that
 * used it is gone). Internal: callers have authorized the change that freed it.
 */
export async function releaseImage(mediaId: string): Promise<void> {
  if ((await imageUseCount(db(), mediaId)) > 0) return;
  const renditions = await transaction((tx) => softDeleteImageRow(tx, mediaId));
  await removeFiles(renditions);
}

/** Renditions of an image for display (no authorization: public images only). */
export async function imageRenditions(mediaId: string): Promise<Rendition[]> {
  const row = await getImageRow(db(), mediaId);
  return row && row.visibility === "public" && row.status === "ready" ? row.renditions : [];
}

/** For the public media route: the file of a public image, or null. */
export async function openPublicImage(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  if (!IMAGE_KEY_PATTERN.test(key)) return null;
  const mediaId = key.split("/")[3]!;
  if (!(await isServableKey(db(), mediaId, key))) return null;
  return objectStorage().get(key);
}
