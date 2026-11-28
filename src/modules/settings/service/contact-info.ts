import "server-only";
import { db, transaction } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { parseContactInput, readContactInfo, type ContactInfo, type ContactInput } from "../domain/contact-info";
import { readStoreSettings, writeStoreSetting } from "../repo/settings-repo";

/** The store's contact details (store setting `store.contact`, settings.store). */

const KEY = "store.contact";

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId) throw new AuthzError("settings.store", "not_admin");
  await authorize(actor, "settings.store");
  return actor.userId;
}

const read = async () => readContactInfo((await readStoreSettings(db(), [KEY])).get(KEY));

export async function contactInfoForAdmin(actor: Actor): Promise<ContactInfo> {
  await allow(actor);
  return read();
}

export type ContactSaveResult = { status: "ok" } | { status: "invalid"; field: string };

export async function saveContactInfo(actor: Actor, input: ContactInput): Promise<ContactSaveResult> {
  const userId = await allow(actor);
  const parsed = parseContactInput(input);
  if ("field" in parsed) return { status: "invalid", field: parsed.field };
  await transaction(async (tx) => {
    const before = await writeStoreSetting(tx, { key: KEY, valueType: "json", value: parsed.value, userId });
    await recordAudit(tx, actor.meta, {
      actorUserId: userId,
      action: "settings.store.contact_updated",
      entityType: "store_setting",
      entityId: null,
      before: before === undefined ? undefined : { key: KEY, value: before },
      after: { key: KEY, value: parsed.value },
    });
  });
  return { status: "ok" };
}

/** Public details for the storefront Contact page and footer (a read, no actor). */
export async function shopContactInfo(): Promise<ContactInfo> {
  return read();
}
