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

/** Whether any cart (also a merged, converted or expired one) already uses this guest token. */
export async function guestHashTaken(client: DbClient, guestTokenHash: string): Promise<boolean> {
  return (await client.cart.count({ where: { guestTokenHash } })) > 0;
}

export async function cartLineCount(client: DbClient, key: CartKey, now: Date): Promise<number> {
  const cart = await client.cart.findFirst({ where: keyWhere(key, now), select: { _count: { select: { items: true } } } });
  return cart?._count.items ?? 0;
}

/** Finds the active cart and locks it, or creates one; returns its id. */
export async function lockOrCreateCart(tx: Tx, key: CartKey, now: Date, guestExpiresAt: Date): Promise<string> {
  const found = await tx.cart.findFirst({ where: keyWhere(key, now), select: { id: true } });
  if (found) {
    await tx.$queryRaw`SELECT 1 FROM carts WHERE id = ${found.id}::uuid FOR UPDATE`;
    if ("guestTokenHash" in key) await tx.cart.update({ where: { id: found.id }, data: { expiresAt: guestExpiresAt } });
    return found.id;
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

/** Lines of the guest cart, which is then marked merged (it is never used again). */
export async function takeGuestCart(tx: Tx, guestTokenHash: string, now: Date) {
  const cart = await tx.cart.findFirst({ where: keyWhere({ guestTokenHash }, now), select: { id: true } });
  if (!cart) return [];
  await tx.$queryRaw`SELECT 1 FROM carts WHERE id = ${cart.id}::uuid FOR UPDATE`;
  const items = await tx.cartItem.findMany({ where: { cartId: cart.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { variantId: true, quantity: true } });
  await tx.cart.update({ where: { id: cart.id }, data: { status: "merged" } });
  return items;
}

export async function removeLines(tx: Tx, cartId: string, variantIds: readonly string[]): Promise<void> {
  if (variantIds.length) await tx.cartItem.deleteMany({ where: { cartId, variantId: { in: [...variantIds] } } });
}
