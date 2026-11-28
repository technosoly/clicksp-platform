import "server-only";
import { cache } from "react";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { parseSiteInput, readSiteAppearance, type SiteAppearance, type SiteInput } from "../domain/site-appearance";
import { readStoreSettings, writeStoreSetting } from "../repo/settings-repo";

/** The storefront's name, wording, social links and announcement bar (store setting `store.site`, settings.store). */

const KEY = "store.site";

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("settings.store", "not_admin");
  await authorize(actor, "settings.store");
  return actor.userId;
}

const read = async () => readSiteAppearance((await readStoreSettings(db(), [KEY])).get(KEY));

export async function siteAppearanceForAdmin(actor: Actor): Promise<SiteAppearance> {
  await allow(actor);
  return read();
}

export type SiteSaveResult = { status: "ok" } | { status: "invalid"; field: string };

export async function saveSiteAppearance(actor: Actor, input: SiteInput): Promise<SiteSaveResult> {
  const userId = await allow(actor);
  const parsed = parseSiteInput(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  await transaction(async (tx) => {
    const before = await writeStoreSetting(tx, { key: KEY, valueType: "json", value: parsed.value, userId });
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "settings.store.site_updated",
      entityType: "store_setting",
      entityId: null,
      before: before === undefined ? undefined : { key: KEY, value: before },
      after: { key: KEY, value: parsed.value },
    });
  });
  return { status: "ok" };
}

/** Public settings for the storefront header, footer and metadata (a read, no actor); one query per request. */
export const shopSiteAppearance = cache(read);
