import type { DbClient } from "@/lib/db";

export async function readSystemSettings(client: DbClient, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await client.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  return new Map(rows.map((r) => [r.key, r.value as unknown]));
}
