import type { DbClient } from "@/lib/db";

export async function readSystemSettings(client: DbClient, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await client.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  return new Map(rows.map((r) => [r.key, r.value as unknown]));
}

export async function readStoreSettings(client: DbClient, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await client.storeSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  return new Map(rows.map((r) => [r.key, r.value as unknown]));
}

/** Inserts or replaces one store setting; returns the previous value (undefined when it was missing). */
export async function writeStoreSetting(
  client: DbClient,
  input: { key: string; valueType: "string" | "integer" | "boolean" | "json" | "money_rial"; value: object; userId: string },
): Promise<unknown> {
  const before = await client.storeSetting.findUnique({ where: { key: input.key }, select: { value: true } });
  await client.storeSetting.upsert({
    where: { key: input.key },
    create: { key: input.key, valueType: input.valueType, value: input.value, updatedById: input.userId },
    update: { value: input.value, valueType: input.valueType, updatedById: input.userId },
  });
  return before?.value as unknown;
}
