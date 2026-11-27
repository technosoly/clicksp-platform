import "server-only";
import { readSessionToken } from "../api/cookies";
import { getCustomer } from "./customer-auth";

/** The signed-in customer's user id, from the session cookie only; null for guests. */
export async function currentCustomerId(): Promise<string | null> {
  const customer = await getCustomer(await readSessionToken("customer"));
  return customer?.user.id ?? null;
}
