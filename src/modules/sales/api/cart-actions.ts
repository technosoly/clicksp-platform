"use server";

import { refresh } from "next/cache";
import { logger } from "@/lib/logger";
import { addToCart, updateCartLine } from "../service/cart";
import { setCartToken } from "./cart-cookie";
import { cartOwner } from "./cart-owner";

export interface CartActionState {
  ok?: boolean;
  /** Translation key under Cart.errors. */
  error?: string;
}

const field = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

export async function addToCartAction(_prev: CartActionState, form: FormData): Promise<CartActionState> {
  try {
    const result = await addToCart(await cartOwner(true), { variantId: field(form, "variantId"), quantity: field(form, "quantity") || "1" });
    if (result.status !== "ok") return { error: result.error };
    if (result.newGuestToken) await setCartToken(result.newGuestToken);
    refresh();
    return { ok: true };
  } catch (error) {
    logger.error("Add to cart failed", { error: String(error) });
    return { error: "unexpected" };
  }
}

/** Plain form action for the cart page (works without JavaScript). */
export async function updateCartLineAction(form: FormData): Promise<void> {
  const quantity = form.get("intent") === "remove" ? "0" : field(form, "quantity");
  try {
    await updateCartLine(await cartOwner(true), { variantId: field(form, "variantId"), quantity });
  } catch (error) {
    logger.error("Cart update failed", { error: String(error) });
  }
  refresh();
}
