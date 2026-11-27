import "server-only";
import { db, transaction } from "@/lib/db";
import { add, multiply, ZERO, type Rial } from "@/lib/money";
import { randomToken, sha256Hex } from "@/lib/security/tokens";
import { shopVariants, type ShopLocale, type ShopVariant } from "@/modules/catalog/service/storefront";
import { sellableQuantities } from "@/modules/inventory/service/stock";
import { cartLineInputSchema, clampQuantity, GUEST_CART_DAYS, lineProblem, MAX_CART_LINES, MAX_LINE_QUANTITY, type LineProblem } from "../domain/cart-rules";
import { cartLineCount, countLines, claimGuestCart, findCart, isUniqueViolation, lineOf, lockOrCreateCart, setLine, type CartKey, type Tx } from "../repo/cart-repo";

/**
 * The shopping cart. A cart is the visitor's own: its owner is resolved on
 * the server from the customer session or the guest cart cookie (see
 * `api/cart-actions.ts`), never from anything in the request body, so no
 * permission key applies. The cart keeps only variant ids and quantities;
 * prices, limits and stock are read fresh every time and never trusted from
 * the client. Stock is not held for a cart; it is reserved when an order is
 * placed.
 */

export type CartOwner = { userId: string } | { guestToken: string } | null;

const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function keyOf(owner: CartOwner): CartKey | null {
  if (!owner) return null;
  if ("userId" in owner) return { userId: owner.userId };
  return GUEST_TOKEN.test(owner.guestToken) ? { guestTokenHash: sha256Hex(owner.guestToken) } : null;
}

const guestExpiry = (now: Date) => new Date(now.getTime() + GUEST_CART_DAYS * 86_400_000);

export interface CartLine {
  variantId: string;
  quantity: number;
  /** null when the part can no longer be bought. */
  item: ShopVariant | null;
  /** Only when the line can be ordered. */
  lineTotal: Rial | null;
  problem: LineProblem | null;
  stock: "in_stock" | "low" | "out";
}

export interface CartView {
  lines: CartLine[];
  /** Sum of the lines that can be ordered. */
  subtotal: Rial;
  count: number;
  /** Every line can be ordered as it is. */
  ready: boolean;
}

export async function viewCart(owner: CartOwner, locale: ShopLocale, now = new Date()): Promise<CartView> {
  const key = keyOf(owner);
  const cart = key ? await findCart(db(), key, now) : null;
  const items = cart?.items ?? [];
  if (items.length === 0) return { lines: [], subtotal: ZERO, count: 0, ready: false };
  const ids = items.map((i) => i.variantId);
  const [variants, available] = await Promise.all([shopVariants(locale, ids), sellableQuantities(ids)]);
  let subtotal = ZERO;
  const lines = items.map((i): CartLine => {
    const item = variants.get(i.variantId) ?? null;
    const stockLeft = available.get(i.variantId) ?? 0;
    const problem = lineProblem({ quantity: i.quantity, variant: item, available: stockLeft });
    const lineTotal = item && problem === null ? multiply(item.price, i.quantity) : null;
    if (lineTotal !== null) subtotal = add(subtotal, lineTotal);
    return { variantId: i.variantId, quantity: i.quantity, item, lineTotal, problem, stock: stockLeft <= 0 ? "out" : stockLeft <= 3 ? "low" : "in_stock" };
  });
  return { lines, subtotal, count: lines.length, ready: lines.every((l) => l.problem === null) };
}

/** Number of different parts in the cart, for the header. */
export async function cartCount(owner: CartOwner, now = new Date()): Promise<number> {
  const key = keyOf(owner);
  return key ? cartLineCount(db(), key, now) : 0;
}

export type CartResult =
  | { status: "ok"; quantity: number; /** Set when a guest cart was just started: store it in the cookie. */ newGuestToken?: string }
  | { status: "invalid"; error: "invalid_input" | "unavailable" | "out_of_stock" | "cart_full" };

/** Runs a cart write, retrying once if two first writes raced to create the cart. */
async function withCart<T>(key: CartKey, fn: (tx: Tx, cartId: string) => Promise<T>, now: Date): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await transaction(async (tx) => fn(tx, await lockOrCreateCart(tx, key, now, guestExpiry(now))));
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

/**
 * Adds a part (or more of it). The line ends within the part's order limits
 * and at most the stock on hand; an out-of-stock part is refused.
 */
export async function addToCart(owner: CartOwner, input: { variantId: unknown; quantity: unknown }, now = new Date()): Promise<CartResult> {
  const parsed = cartLineInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.quantity < 1) return { status: "invalid", error: "invalid_input" };
  const { variantId, quantity } = parsed.data;
  const [variants, available] = await Promise.all([shopVariants("fa", [variantId]), sellableQuantities([variantId])]);
  const variant = variants.get(variantId);
  if (!variant) return { status: "invalid", error: "unavailable" };
  const inStock = available.get(variantId) ?? 0;
  if (inStock <= 0) return { status: "invalid", error: "out_of_stock" };

  let key = keyOf(owner);
  let newGuestToken: string | undefined;
  // A guest cookie is used only for a cart this server started for it. A token
  // with no active cart (never issued, or its cart was merged, ordered or
  // expired) is replaced by a fresh one, so a planted cookie can't seed a cart.
  if (key && "guestTokenHash" in key && !(await findCart(db(), key, now))) key = null;
  if (!key) {
    newGuestToken = randomToken(32);
    key = { guestTokenHash: sha256Hex(newGuestToken) };
  }
  const result = await withCart(
    key,
    async (tx, cartId) => {
      const existing = await lineOf(tx, cartId, variantId);
      if (!existing && (await countLines(tx, cartId)) >= MAX_CART_LINES) return null;
      const target = Math.min(clampQuantity((existing?.quantity ?? 0) + quantity, variant), Math.max(inStock, existing?.quantity ?? 0), MAX_LINE_QUANTITY);
      await setLine(tx, cartId, variantId, target);
      return target;
    },
    now,
  );
  if (result === null) return { status: "invalid", error: "cart_full" };
  return { status: "ok", quantity: result, ...(newGuestToken ? { newGuestToken } : {}) };
}

/** Sets a line's quantity; 0 removes it. Limits are shown on the cart page rather than silently applied. */
export async function updateCartLine(owner: CartOwner, input: { variantId: unknown; quantity: unknown }, now = new Date()): Promise<CartResult> {
  const parsed = cartLineInputSchema.safeParse(input);
  const key = keyOf(owner);
  if (!parsed.success || !key) return { status: "invalid", error: "invalid_input" };
  const { variantId, quantity } = parsed.data;
  const cart = await findCart(db(), key, now);
  if (!cart || !cart.items.some((i) => i.variantId === variantId)) return { status: "invalid", error: "invalid_input" };
  await withCart(key, (tx, cartId) => setLine(tx, cartId, variantId, quantity), now);
  return { status: "ok", quantity };
}

/**
 * After a guest signs in: moves the guest cart's lines into the customer's
 * cart (adding quantities, within the cart's limits) and retires the guest
 * cart. Prices and stock are checked again when the cart is shown.
 */
export async function mergeGuestCart(userId: string, guestToken: string, now = new Date()): Promise<void> {
  if (!GUEST_TOKEN.test(guestToken)) return;
  const guestHash = sha256Hex(guestToken);
  // Claim and copy in one transaction: if the copy fails, the guest cart stays as it was.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await transaction(async (tx) => {
        const moved = await claimGuestCart(tx, guestHash, now);
        if (moved.length === 0) return;
        const cartId = await lockOrCreateCart(tx, { userId }, now, guestExpiry(now));
        let lines = await countLines(tx, cartId);
        for (const item of moved) {
          const existing = await lineOf(tx, cartId, item.variantId);
          if (!existing && lines >= MAX_CART_LINES) continue;
          if (!existing) lines += 1;
          await setLine(tx, cartId, item.variantId, Math.min(MAX_LINE_QUANTITY, (existing?.quantity ?? 0) + item.quantity));
        }
      });
      return;
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}
