import "server-only";
import { currentCustomerId } from "@/modules/identity/api/customer-session";
import { mergeGuestCart, type CartOwner } from "../service/cart";
import { clearCartToken, readCartToken } from "./cart-cookie";

/**
 * Whose cart this request may see and change: the signed-in customer's, else
 * the guest cookie's. Resolved from cookies only.
 *
 * `canWriteCookies` is true in Server Actions: there a guest cart left in the
 * browser after signing in is merged into the customer's cart and the guest
 * cookie cleared. Pages can't set cookies, so they only read.
 */
export async function cartOwner(canWriteCookies = false): Promise<CartOwner> {
  const [userId, guestToken] = await Promise.all([currentCustomerId(), readCartToken()]);
  if (userId) {
    if (guestToken && canWriteCookies) {
      await mergeGuestCart(userId, guestToken);
      await clearCartToken();
    }
    return { userId };
  }
  return guestToken ? { guestToken } : null;
}
