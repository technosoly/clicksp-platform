/**
 * Database access for placing and reading orders. The database guards the
 * rest: orders start in pending_payment, lines are immutable snapshots, totals
 * must match the lines at commit, and every status change is logged.
 */
import { Prisma, type OrderStatus } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";

export type Tx = Prisma.TransactionClient;

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

/** Most addresses a customer keeps; older ones are retired when a new one is saved. */
const MAX_ADDRESSES = 10;

/**
 * Makes the address the customer's default: an identical saved address is
 * reused, otherwise a new one is added and the oldest beyond the limit are
 * retired (soft-deleted).
 */
export async function saveDefaultAddress(tx: Tx, userId: string, address: NewOrder["address"]): Promise<void> {
  await tx.deliveryAddress.updateMany({ where: { userId, isDefault: true, deletedAt: null }, data: { isDefault: false } });
  const same = await tx.deliveryAddress.findFirst({ where: { userId, deletedAt: null, ...address }, select: { id: true } });
  if (same) {
    await tx.deliveryAddress.update({ where: { id: same.id }, data: { isDefault: true } });
    return;
  }
  await tx.deliveryAddress.create({ data: { userId, ...address, isDefault: true } });
  const extra = await tx.deliveryAddress.findMany({ where: { userId, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: MAX_ADDRESSES, select: { id: true } });
  if (extra.length) await tx.deliveryAddress.updateMany({ where: { id: { in: extra.map((a) => a.id) } }, data: { deletedAt: new Date() } });
}

// Unpaid orders --------------------------------------------------------------------

/** The customer's orders still awaiting payment. */
export async function openOrderCount(tx: Tx, userId: string): Promise<number> {
  return tx.order.count({ where: { userId, status: "pending_payment" } });
}

/** Unpaid orders whose stock hold has run out (oldest first, a few at a time). */
export async function expiredUnpaidOrders(client: DbClient, now: Date, take: number): Promise<string[]> {
  const rows = await client.order.findMany({
    // A payment being checked with the bank keeps the order (for a while; reconciliation takes stuck ones).
    where: {
      status: "pending_payment",
      reservations: { some: { status: "active", expiresAt: { lt: now } } },
      paymentTransactions: { none: { kind: "payment", status: "verifying", updatedAt: { gt: new Date(now.getTime() - VERIFYING_HOLD_MS) } } },
    },
    orderBy: { placedAt: "asc" },
    take,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** How long a payment being verified keeps its order from expiring or being cancelled. */
export const VERIFYING_HOLD_MS = 30 * 60_000;

/** An unpaid order whose payment is being checked with the bank right now. */
export async function hasPaymentInProgress(tx: Tx, orderId: string, now = new Date()): Promise<boolean> {
  return (await tx.paymentTransaction.count({ where: { orderId, kind: "payment", status: "verifying", updatedAt: { gt: new Date(now.getTime() - VERIFYING_HOLD_MS) } } })) > 0;
}

/** Locks an order that still awaits payment; false if it was paid or cancelled meanwhile. */
export async function lockUnpaidOrder(tx: Tx, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId}::uuid AND status = 'pending_payment' FOR UPDATE`;
  return rows.length > 0;
}

/** Amount, number, owner and language of an order locked by lockUnpaidOrder. */
export async function payableOrder(tx: Tx, orderId: string) {
  return tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, grandTotal: true, userId: true, locale: true } });
}

export async function orderNumberAndLocale(client: DbClient, orderId: string) {
  return client.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, locale: true, userId: true } });
}

/** Marks an unpaid order paid; the database refuses unless a succeeded payment covers the total. */
export async function markOrderPaid(tx: Tx, orderId: string, reason: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.status_reason', ${reason}, true)`;
  await tx.order.update({ where: { id: orderId }, data: { status: "paid" } });
}

/** Cancels an unpaid order; the reason lands in its status history. */
export async function cancelUnpaidOrder(tx: Tx, orderId: string, reason: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.status_reason', ${reason}, true)`;
  await tx.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
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

// Admin ----------------------------------------------------------------------------

/** Orders whose stock is held or taken only in these warehouses (null = every order). */
const inWarehouses = (warehouseIds: readonly string[] | null): Prisma.OrderWhereInput =>
  warehouseIds === null
    ? {}
    : // Every hold in their warehouses, and at least one: the same rule as the order screen.
      { AND: [{ reservations: { some: { balance: { warehouseId: { in: [...warehouseIds] } } } } }, { reservations: { none: { balance: { warehouseId: { notIn: [...warehouseIds] } } } } }] };

export async function adminOrderList(client: DbClient, warehouseIds: readonly string[] | null, status: OrderStatus | null, take: number) {
  return client.order.findMany({
    where: { ...inWarehouses(warehouseIds), ...(status ? { status } : {}) },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, orderNumber: true, status: true, grandTotal: true, placedAt: true, customerName: true, _count: { select: { items: true } } },
  });
}

export async function adminOrder(client: DbClient, orderNumber: bigint) {
  return client.order.findUnique({
    where: { orderNumber },
    select: {
      ...orderSelect,
      userId: true,
      customerName: true,
      customerPhone: true,
      cancelReason: true,
      statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { fromStatus: true, toStatus: true, reason: true, createdAt: true, actor: { select: { name: true } } } },
      reservations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { variantId: true, quantity: true, status: true, expiresAt: true, balance: { select: { warehouseId: true, warehouse: { select: { code: true } }, location: { select: { code: true } } } } },
      },
    },
  });
}

/** Retires one of the customer's own addresses (the user id is part of the match). */
export async function retireAddress(client: DbClient, userId: string, id: string): Promise<boolean> {
  const { count } = await client.deliveryAddress.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date(), isDefault: false } });
  return count > 0;
}

/** Makes one of the customer's own addresses the default. */
export async function makeDefaultAddress(tx: Tx, userId: string, id: string): Promise<boolean> {
  const owned = await tx.deliveryAddress.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  if (!owned) return false;
  await tx.deliveryAddress.updateMany({ where: { userId, isDefault: true, deletedAt: null }, data: { isDefault: false } });
  await tx.deliveryAddress.update({ where: { id }, data: { isDefault: true } });
  return true;
}

// Fulfilment ------------------------------------------------------------------------

/** Locks an order for a fulfilment step and returns what the step needs. */
export async function lockOrderForFulfilment(tx: Tx, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, shippingMethodId: true, items: { select: { id: true, variantId: true, quantity: true } } },
  });
}

/** Moves an order along its state machine (the database refuses a step that isn't allowed). */
export async function setOrderStatus(tx: Tx, orderId: string, status: OrderStatus, reason: string | null): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.status_reason', ${reason ?? ""}, true)`;
  await tx.order.update({ where: { id: orderId }, data: { status } });
}

// For accounting ------------------------------------------------------------------------

/** An order's totals and when it was paid, for its journal posting. */
export async function orderForPosting(client: DbClient, orderId: string) {
  const [order, paid] = await Promise.all([
    client.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, subtotal: true, discountTotal: true, shippingTotal: true, taxTotal: true, grandTotal: true } }),
    client.orderStatusHistory.findFirst({ where: { orderId, toStatus: "paid" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return order && paid ? { ...order, paidAt: paid.createdAt } : null;
}
