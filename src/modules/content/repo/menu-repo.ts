/** Database access for the header and footer menus (one row per key). */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

export async function menusByKeys(client: DbClient, keys: readonly string[]) {
  return client.menu.findMany({ where: { key: { in: [...keys] } }, select: { key: true, document: true, isActive: true, updatedAt: true } });
}

/** Saves a menu document; returns the previous one (for the audit), locking the row. */
export async function saveMenu(tx: Tx, key: "header" | "footer", document: Prisma.InputJsonValue): Promise<unknown> {
  await tx.$executeRaw`INSERT INTO menus (key, location, schema_version, document) VALUES (${key}, ${key}::menu_location, 1, '{"version":1,"items":[]}'::jsonb) ON CONFLICT (key) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ document: unknown }[]>`SELECT document FROM menus WHERE key = ${key} FOR UPDATE`;
  await tx.menu.update({ where: { key }, data: { document, schemaVersion: 1, isActive: true } });
  return row?.document ?? null;
}
