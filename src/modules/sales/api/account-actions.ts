"use server";

import { refresh } from "next/cache";
import { currentCustomer } from "@/modules/identity/service/current-customer";
import { makeMyDefaultAddress, removeMyAddress } from "../service/addresses";

/** The customer's saved addresses; the customer comes from the session only. */

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

export async function addressAction(form: FormData): Promise<void> {
  const customer = await currentCustomer();
  if (!customer) return;
  const id = field(form, "addressId");
  if (form.get("intent") === "remove") await removeMyAddress(customer, id);
  else await makeMyDefaultAddress(customer, id);
  refresh();
}
