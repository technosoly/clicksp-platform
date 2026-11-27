import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getPrivateFileRow, insertPrivateFileRow } from "../repo/media-repo";
import { objectStorage } from "../storage/object-storage";

/**
 * Private files: uploads the store keeps for its own work (import files).
 * They are stored under `private/` and never served by the public media
 * route. Internal: the calling service authorizes the upload and every read.
 */

const MIME_EXT: Record<string, string> = { "text/csv": "csv" };

export async function storePrivateFile(file: { userId: string; name: string; mimeType: keyof typeof MIME_EXT; bytes: Uint8Array }, now = new Date()): Promise<string> {
  const id = randomUUID();
  const storage = objectStorage();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const key = `private/imports/${yyyy}/${mm}/${id}.${MIME_EXT[file.mimeType]}`;
  await storage.put(key, file.bytes, file.mimeType);
  try {
    await insertPrivateFileRow(db(), {
      id,
      storageKey: key,
      bucket: storage.name,
      originalFilename: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 200) || "file",
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      uploadedById: file.userId,
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
  return id;
}

export async function readPrivateFile(mediaId: string): Promise<Uint8Array | null> {
  const row = await getPrivateFileRow(db(), mediaId);
  if (!row) return null;
  const object = await objectStorage().get(row.storageKey);
  if (!object) return null;
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}
