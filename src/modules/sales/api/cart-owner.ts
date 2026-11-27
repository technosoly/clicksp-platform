import "server-only";
import { logger } from "@/lib/logger";
import { currentCustomerId } from "@/modules/identity/service/current-customer";
import { mergeGuestCart, type CartOwner } from "../service/cart";
import { clearCartToken, readCartToken } from "./cart-cookie";

/**
 * Whose cart this request may see and change: the signed-in customer's, else
 * the guest cookie's. Resolved from cookies only.
 *
 * A guest cart still in the browser after signing in is merged into the
 * customer's cart here (the merge claims it atomically, so it happens once).
 * In Server Actions (`canWriteCookies`) the retired guest cookie is cleared
 * too; pages can't set cookies, and a leftover cookie finds nothing to merge.
 * A failed merge is logged and never blocks the cart.
 */
export async function cartOwner(canWriteCookies = false): Promise<CartOwner> {
  const [userId, guestToken] = await Promise.all([currentCustomerId(), readCartToken()]);
  if (userId) {
    if (guestToken) {
      try {
        await mergeGuestCart(userId, guestToken);
        if (canWriteCookies) await clearCartToken();
      } catch (error) {
        logger.error("Guest cart merge failed", { error: String(error) });
      }
    }
    return { userId };
  }
  return guestToken ? { guestToken } : null;
}
