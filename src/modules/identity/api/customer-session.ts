import "server-only";
import { getCustomer } from "../service/customer-auth";
import { readSessionToken } from "./cookies";

/** The signed-in customer's user id, from the session cookie only; null for guests. */
export async function currentCustomerId(): Promise<string | null> {
  const customer = await getCustomer(await readSessionToken("customer"));
  return customer?.user.id ?? null;
}
