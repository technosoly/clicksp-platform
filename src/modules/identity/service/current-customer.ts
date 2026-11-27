import "server-only";
import { readSessionToken } from "../api/cookies";
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
  return { userId: customer.user.id, phone: customer.user.phoneNumber, name: customer.user.name ?? null };
}

export async function currentCustomerId(): Promise<string | null> {
  return (await currentCustomer())?.userId ?? null;
}
