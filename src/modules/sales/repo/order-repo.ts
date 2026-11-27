/**
 * Database access for placing and reading orders. The database guards the
 * rest: orders start in pending_payment, lines are immutable snapshots, totals
 * must match the lines at commit, and every status change is logged.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/** Locks the customer's active cart for checkout and returns its lines. */
export async function lockCustomerCart(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE user_id = ${userId}::uuid AND status = 'active' FOR UPDATE`;
  const id = rows[0]?.id;
  if (!id) return null;
  const items = await tx.cartItem.findMany({ where: { cartId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { variantId: true, quantity: true } });
  return { id, items };
}

export async function markCartConverted(tx: Tx, cartId: string): Promise<void> {
  await tx.cart.update({ where: { id: cartId }, data: { status: "converted" } });
}

/** Who the database records as acting (order status history). */
export async function setActingUser(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${userId}, true)`;
}

export interface NewOrder {
  userId: string;
  locale: string;
  subtotal: bigint;
  discountTotal: bigint;
  shippingTotal: bigint;
  taxTotal: bigint;
  grandTotal: bigint;
  shippingMethodId: string;
  customerName: string;
  customerPhone: string;
  customerNote: string | null;
  items: {
    productId: string;
    variantId: string;
    sku: string;
    titleFa: string;
    titleEn: string | null;
    snapshot: Prisma.InputJsonValue;
    quantity: number;
    unitPrice: bigint;
    discountTotal: bigint;
    lineTotal: bigint;
  }[];
  address: {
    recipientName: string;
    phone: string;
    provinceCode: string;
    province: string;
    city: string;
    addressLine: string;
    plaque: string | null;
    unit: string | null;
    postalCode: string;
  };
}

export async function insertOrder(tx: Tx, order: NewOrder): Promise<{ id: string; orderNumber: bigint }> {
  const { items, address, ...columns } = order;
  return tx.order.create({
    data: {
      ...columns,
      items: { create: items },
      addresses: { create: { type: "shipping", ...address } },
    },
    select: { id: true, orderNumber: true },
  });
}

export async function insertOutboxEvent(tx: Tx, event: { topic: string; aggregateType: string; aggregateId: string; payload: Prisma.InputJsonValue; dedupeKey: string }): Promise<void> {
  await tx.outboxEvent.create({ data: event });
}

// Saved addresses ----------------------------------------------------------------

const addressSelect = {
  id: true,
  recipientName: true,
  phone: true,
  provinceCode: true,
  city: true,
  addressLine: true,
  plaque: true,
  unit: true,
  postalCode: true,
  isDefault: true,
} satisfies Prisma.DeliveryAddressSelect;

export async function savedAddresses(client: DbClient, userId: string) {
  return client.deliveryAddress.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    take: 10,
    select: addressSelect,
  });
}

/** Saves the address as the customer's default (one default each, by a partial unique index). */
export async function saveDefaultAddress(tx: Tx, userId: string, address: NewOrder["address"]): Promise<void> {
  await tx.deliveryAddress.updateMany({ where: { userId, isDefault: true, deletedAt: null }, data: { isDefault: false } });
  await tx.deliveryAddress.create({ data: { userId, ...address, isDefault: true } });
}

// Reading orders -------------------------------------------------------------------

const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  taxTotal: true,
  grandTotal: true,
  placedAt: true,
  customerNote: true,
  shippingMethod: { select: { translations: { select: { locale: true, name: true } } } },
  items: { orderBy: { createdAt: "asc" }, select: { id: true, sku: true, titleFa: true, titleEn: true, snapshot: true, quantity: true, unitPrice: true, lineTotal: true } },
  addresses: { where: { type: "shipping" }, select: { recipientName: true, phone: true, provinceCode: true, province: true, city: true, addressLine: true, plaque: true, unit: true, postalCode: true } },
} satisfies Prisma.OrderSelect;

/** One of the customer's own orders (the user id is part of the lookup). */
export async function customerOrder(client: DbClient, userId: string, orderNumber: bigint) {
  return client.order.findFirst({ where: { userId, orderNumber }, select: orderSelect });
}

export async function customerOrders(client: DbClient, userId: string, take: number) {
  return client.order.findMany({
    where: { userId },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, orderNumber: true, status: true, grandTotal: true, placedAt: true, _count: { select: { items: true } } },
  });
}
