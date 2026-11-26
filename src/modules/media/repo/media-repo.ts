/** Database access for media files (the media_library table). */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { Rendition } from "../domain/image-rules";

type Tx = Prisma.TransactionClient;

export async function insertImageRow(
  tx: Tx,
  row: {
    id: string;
    storageKey: string;
    bucket: string;
    originalFilename: string;
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
    renditions: Rendition[];
    uploadedById: string;
  },
): Promise<void> {
  await tx.mediaAsset.create({
    data: {
      id: row.id,
      storageKey: row.storageKey,
      bucket: row.bucket,
      kind: "image",
      visibility: "public",
      status: "ready",
      originalFilename: row.originalFilename,
      mimeType: "image/webp",
      sizeBytes: BigInt(row.sizeBytes),
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      renditions: row.renditions as unknown as Prisma.InputJsonValue,
      uploadedById: row.uploadedById,
    },
  });
}

export async function getImageRow(client: DbClient, id: string) {
  const row = await client.mediaAsset.findFirst({
    where: { id, kind: "image", deletedAt: null },
    select: { id: true, storageKey: true, width: true, height: true, renditions: true, visibility: true, status: true },
  });
  return row ? { ...row, renditions: row.renditions as unknown as Rendition[] } : null;
}

/** Marks an image deleted (its files are removed after the transaction). */
export async function softDeleteImageRow(tx: Tx, id: string): Promise<Rendition[]> {
  const row = await tx.mediaAsset.findFirst({ where: { id, deletedAt: null }, select: { renditions: true } });
  if (!row) return [];
  await tx.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  return row.renditions as unknown as Rendition[];
}

/** Whether a public, ready, not deleted image has a rendition with this key. */
export async function isServableKey(client: DbClient, mediaId: string, key: string): Promise<boolean> {
  const rows = await client.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM media_library
      WHERE id = ${mediaId}::uuid AND kind = 'image' AND visibility = 'public' AND status = 'ready' AND deleted_at IS NULL
        AND renditions @> ${JSON.stringify([{ key }])}::jsonb
    ) AS ok`;
  return rows[0]?.ok === true;
}

/** How many places still use this image (products, brands, categories, banners, articles). */
export async function imageUseCount(client: DbClient, mediaId: string): Promise<number> {
  const rows = await client.$queryRaw<{ n: bigint }[]>`
    SELECT (
      (SELECT count(*) FROM product_images WHERE media_id = ${mediaId}::uuid) +
      (SELECT count(*) FROM brands WHERE logo_media_id = ${mediaId}::uuid) +
      (SELECT count(*) FROM categories WHERE image_media_id = ${mediaId}::uuid)
    ) AS n`;
  return Number(rows[0]?.n ?? 0n);
}
