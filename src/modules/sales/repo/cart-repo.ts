/**
 * Database access for carts. A cart belongs to a signed-in customer (one
 * active cart each, enforced by a partial unique index) or to a guest
 * browser, identified by the SHA-256 of a random cookie token; the token
 * itself is never stored.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export type CartKey = { userId: string } | { guestTokenHash: string };

const keyWhere = (key: CartKey, now: Date): Prisma.CartWhereInput =>
  "userId" in key ? { userId: key.userId, status: "active" } : { guestTokenHash: key.guestTokenHash, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

export async function findCart(client: DbClient, key: CartKey, now: Date) {
  return client.cart.findFirst({
    where: keyWhere(key, now),
    select: { id: true, items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { variantId: true, quantity: true } } },
  });
}

export async function cartLineCount(client: DbClient, key: CartKey, now: Date): Promise<number> {
  const cart = await client.cart.findFirst({ where: keyWhere(key, now), select: { _count: { select: { items: true } } } });
  return cart?._count.items ?? 0;
}

/** The cart stopped being active (merged or ordered) while a change to it waited. */
export class CartRetiredError extends Error {
  constructor() {
    super("cart_retired");
  }
}

/** Guest carts this long past their expiry are deleted (their cookie is long gone). */
const PURGE_AFTER_DAYS = 30;

/**
 * Finds the active cart and locks it, or creates one; returns its id. The
 * status is checked again under the lock, so a change never lands in a cart
 * that was merged or ordered meanwhile.
 */
export async function lockOrCreateCart(tx: Tx, key: CartKey, now: Date, guestExpiresAt: Date): Promise<string> {
  const found = await tx.cart.findFirst({ where: keyWhere(key, now), select: { id: true } });
  if (found) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE id = ${found.id}::uuid AND status = 'active' FOR UPDATE`;
    if (locked.length === 0) throw new CartRetiredError();
    if ("guestTokenHash" in key) await tx.cart.update({ where: { id: found.id }, data: { expiresAt: guestExpiresAt } });
    return found.id;
  }
  if ("guestTokenHash" in key) {
    // Bounded housekeeping: each new guest cart removes a few long-expired ones.
    const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000);
    await tx.$executeRaw`DELETE FROM carts WHERE id IN (SELECT c.id FROM carts c WHERE c.user_id IS NULL AND c.expires_at < ${cutoff} AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.cart_id = c.id) LIMIT 20)`;
  }
  const created = await tx.cart.create({
    data: "userId" in key ? { userId: key.userId } : { guestTokenHash: key.guestTokenHash, expiresAt: guestExpiresAt },
    select: { id: true },
  });
  return created.id;
}

export async function lineOf(tx: Tx, cartId: string, variantId: string) {
  return tx.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } }, select: { quantity: true } });
}

export async function countLines(tx: Tx, cartId: string): Promise<number> {
  return tx.cartItem.count({ where: { cartId } });
}

export async function setLine(tx: Tx, cartId: string, variantId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await tx.cartItem.deleteMany({ where: { cartId, variantId } });
    return;
  }
  await tx.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, quantity },
    update: { quantity },
  });
}

/**
 * Claims the guest cart for a merge: marks it merged in one conditional
 * UPDATE (a second, concurrent merge finds nothing) and returns its lines.
 */
export async function claimGuestCart(tx: Tx, guestTokenHash: string, now: Date) {
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE carts SET status = 'merged', updated_at = now()
     WHERE guest_token_hash = ${guestTokenHash} AND status = 'active' AND (expires_at IS NULL OR expires_at > ${now})
    RETURNING id`;
  const id = claimed[0]?.id;
  if (!id) return [];
  return tx.cartItem.findMany({ where: { cartId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { variantId: true, quantity: true } });
}

export async function removeLines(tx: Tx, cartId: string, variantIds: readonly string[]): Promise<void> {
  if (variantIds.length) await tx.cartItem.deleteMany({ where: { cartId, variantId: { in: [...variantIds] } } });
}
