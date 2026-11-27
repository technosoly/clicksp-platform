import "server-only";
import { db, transaction } from "@/lib/db";
import type { CurrentCustomer } from "@/modules/identity/service/current-customer";
import { makeDefaultAddress, retireAddress, savedAddresses } from "../repo/order-repo";

/**
 * The customer's saved delivery addresses (added at checkout). Every call is
 * limited to the signed-in customer's own rows.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function myAddresses(customer: CurrentCustomer) {
  return savedAddresses(db(), customer.userId);
}

export async function removeMyAddress(customer: CurrentCustomer, id: string): Promise<boolean> {
  return UUID.test(id) ? retireAddress(db(), customer.userId, id) : false;
}

export async function makeMyDefaultAddress(customer: CurrentCustomer, id: string): Promise<boolean> {
  return UUID.test(id) ? transaction((tx) => makeDefaultAddress(tx, customer.userId, id)) : false;
}
