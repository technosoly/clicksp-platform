import "server-only";
import { db } from "@/lib/db";
import { normalizeForStorage } from "@/lib/persian-text";
import { readSessionToken } from "../api/cookies";
import { setUserName } from "../repo/identity-repo";
import { getCustomer } from "./customer-auth";

export interface CurrentCustomer {
  userId: string;
  /** Verified mobile number (E.164). */
  phone: string;
  name: string | null;
}

/** The signed-in customer, from the session cookie only; null for guests. */
export async function currentCustomer(): Promise<CurrentCustomer | null> {
  const customer = await getCustomer(await readSessionToken("customer"));
  if (!customer?.user.phoneNumber) return null;
  return { userId: customer.user.id, phone: customer.user.phoneNumber, name: customer.user.name || null };
}

export async function currentCustomerId(): Promise<string | null> {
  return (await currentCustomer())?.userId ?? null;
}

/** The customer's own display name (shown on the account page, used to prefill checkout). */
export async function setMyName(customer: CurrentCustomer, input: string): Promise<{ status: "ok" } | { status: "invalid" }> {
  const name = normalizeForStorage(input).trim();
  if (name.length > 120) return { status: "invalid" };
  await setUserName(db(), customer.userId, name);
  return { status: "ok" };
}
