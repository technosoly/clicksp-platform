import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { DisplayUnit } from "@/lib/money";
import { readStoreSettings, readSystemSettings } from "../repo/settings-repo";

/**
 * Settings the catalog screens need. Read by services for display and
 * request lifetimes (a system read, not a user action), so there is no
 * actor. An invalid or missing value falls back to the seeded default.
 */
export async function getDisplayUnit(): Promise<DisplayUnit> {
  const parsed = z.enum(["toman", "rial"]).safeParse((await readStoreSettings(db(), ["store.display_currency_unit"])).get("store.display_currency_unit"));
  return parsed.success ? parsed.data : "toman";
}

/** How long a pending approval request stays open (security.approval_ttl_hours). */
export async function getApprovalTtlHours(): Promise<number> {
  const parsed = z.number().int().min(1).max(720).safeParse((await readSystemSettings(db(), ["security.approval_ttl_hours"])).get("security.approval_ttl_hours"));
  return parsed.success ? parsed.data : 72;
}
