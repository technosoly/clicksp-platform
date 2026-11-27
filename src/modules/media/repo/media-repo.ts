/** Database access for media files (the media_library table). */
import { Prisma } from "@/generated/prisma/client";
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

export async function lockImageRow(tx: Tx, mediaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM media_library WHERE id = ${mediaId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  return rows.length === 1;
}

let referencing: { table: string; column: string }[] | undefined;

/**
 * Every column that references media_library, read from the database's own
 * foreign keys, so a table added later is counted without code changes.
 */
export async function mediaReferences(client: DbClient): Promise<{ table: string; column: string }[]> {
  referencing ??= await client.$queryRaw<{ table: string; column: string }[]>`
    SELECT c.conrelid::regclass::text AS "table", a.attname::text AS "column"
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'media_library'::regclass
    ORDER BY 1, 2`;
  return referencing;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** How many rows anywhere still reference this image. */
export async function imageUseCount(client: DbClient, mediaId: string): Promise<number> {
  let total = 0;
  for (const ref of await mediaReferences(client)) {
    // Names come from pg_constraint, never from input; checked anyway.
    if (!IDENTIFIER.test(ref.table) || !IDENTIFIER.test(ref.column)) throw new Error(`unexpected media reference ${ref.table}.${ref.column}`);
    const rows = await client.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM ${Prisma.raw(`"${ref.table}"`)} WHERE ${Prisma.raw(`"${ref.column}"`)} = ${mediaId}::uuid`;
    total += Number(rows[0]?.n ?? 0n);
  }
  return total;
}

/** A private file (an import upload): never served by the public media route. */
export async function insertPrivateFileRow(
  client: DbClient,
  row: { id: string; storageKey: string; bucket: string; originalFilename: string; mimeType: string; sizeBytes: number; sha256: string; uploadedById: string },
): Promise<void> {
  await client.mediaAsset.create({
    data: { ...row, kind: "document", visibility: "private", status: "ready", sizeBytes: BigInt(row.sizeBytes) },
  });
}

export async function getPrivateFileRow(client: DbClient, id: string) {
  return client.mediaAsset.findFirst({ where: { id, kind: "document", visibility: "private", deletedAt: null }, select: { storageKey: true, sizeBytes: true } });
}
