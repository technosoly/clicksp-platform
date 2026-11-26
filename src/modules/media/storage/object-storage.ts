import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Where media files live. Pluggable: the default keeps them in a folder on
 * the server (MEDIA_STORAGE_DIR); an S3-compatible adapter is added once a
 * provider is chosen (see docs/DEPLOYMENT.md). Keys are validated by the
 * caller and again here, so a key can never leave the storage root.
 */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** A stream of the object, or null when it doesn't exist. */
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9]+(?:[/._-][a-z0-9]+)*$/;

export class LocalDiskStorage implements ObjectStorage {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const temp = `${full}.${randomUUID()}.tmp`;
    await writeFile(temp, body, { flag: "wx" });
    await rename(temp, full);
  }

  async get(key: string) {
    const full = this.resolve(key);
    try {
      const info = await stat(full);
      if (!info.isFile()) return null;
      return { body: Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>, size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let storage: ObjectStorage | undefined;

export function objectStorage(): ObjectStorage {
  storage ??= new LocalDiskStorage(env().MEDIA_STORAGE_DIR);
  return storage;
}
