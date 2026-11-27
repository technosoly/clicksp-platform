/**
 * Database access for shipping zones, methods and rates. Nothing is seeded:
 * the store enters its own methods and prices.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { MethodData, ZoneData } from "../domain/shipping-input";

export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const names = { select: { locale: true, name: true } } as const;

function translations(fa: string, en: string | null) {
  return [{ locale: "fa", name: fa }, ...(en ? [{ locale: "en", name: en }] : [])];
}

// Zones ------------------------------------------------------------------------

export async function listZones(client: DbClient) {
  return client.shippingZone.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    select: { id: true, code: true, isActive: true, translations: names, regions: { where: { city: null }, select: { provinceCode: true } } },
  });
}

export async function getZone(client: DbClient, id: string) {
  return client.shippingZone.findUnique({
    where: { id },
    select: { id: true, code: true, isActive: true, translations: names, regions: { where: { city: null }, select: { provinceCode: true } } },
  });
}

export async function insertZone(tx: Tx, data: ZoneData): Promise<string> {
  const row = await tx.shippingZone.create({
    data: {
      code: data.code,
      isActive: data.isActive,
      translations: { create: translations(data.faName, data.enName) },
      regions: { create: data.provinces.map((provinceCode) => ({ provinceCode })) },
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateZoneRow(tx: Tx, id: string, data: ZoneData): Promise<void> {
  await tx.shippingZone.update({ where: { id }, data: { code: data.code, isActive: data.isActive } });
  await tx.shippingZoneTranslation.deleteMany({ where: { zoneId: id } });
  await tx.shippingZoneTranslation.createMany({ data: translations(data.faName, data.enName).map((t) => ({ ...t, zoneId: id })) });
  await tx.shippingZoneRegion.deleteMany({ where: { zoneId: id, city: null } });
  await tx.shippingZoneRegion.createMany({ data: data.provinces.map((provinceCode) => ({ zoneId: id, provinceCode })) });
}

// Methods ----------------------------------------------------------------------

const methodSelect = {
  id: true,
  code: true,
  kind: true,
  minDeliveryDays: true,
  maxDeliveryDays: true,
  isActive: true,
  sortOrder: true,
  translations: { select: { locale: true, name: true, description: true } },
} satisfies Prisma.ShippingMethodSelect;

export async function listMethods(client: DbClient) {
  return client.shippingMethod.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
    select: { ...methodSelect, _count: { select: { rates: true } } },
  });
}

export async function getMethod(client: DbClient, id: string) {
  return client.shippingMethod.findUnique({
    where: { id },
    select: {
      ...methodSelect,
      rates: {
        orderBy: [{ zone: { code: "asc" } }, { minWeightGrams: "asc" }],
        select: {
          id: true,
          zoneId: true,
          minWeightGrams: true,
          maxWeightGrams: true,
          baseAmount: true,
          perKgAmount: true,
          freeAboveSubtotal: true,
          isActive: true,
          zone: { select: { code: true, translations: names } },
        },
      },
    },
  });
}

function methodTranslations(data: MethodData) {
  return [
    { locale: "fa", name: data.faName, description: data.faDescription },
    ...(data.enName ? [{ locale: "en", name: data.enName, description: data.enDescription }] : []),
  ];
}

const methodColumns = (data: MethodData) => ({
  code: data.code,
  kind: data.kind,
  minDeliveryDays: data.minDays,
  maxDeliveryDays: data.maxDays,
  sortOrder: data.sortOrder ?? 0,
  isActive: data.isActive,
});

export async function insertMethod(tx: Tx, data: MethodData): Promise<string> {
  const row = await tx.shippingMethod.create({ data: { ...methodColumns(data), translations: { create: methodTranslations(data) } }, select: { id: true } });
  return row.id;
}

export async function updateMethodRow(tx: Tx, id: string, data: MethodData): Promise<void> {
  await tx.shippingMethod.update({ where: { id }, data: methodColumns(data) });
  await tx.shippingMethodTranslation.deleteMany({ where: { methodId: id } });
  await tx.shippingMethodTranslation.createMany({ data: methodTranslations(data).map((t) => ({ ...t, methodId: id })) });
}

// Rates ------------------------------------------------------------------------

export interface RateRow {
  zoneId: string;
  baseAmount: bigint;
  perKgAmount: bigint;
  freeAboveSubtotal: bigint | null;
  minWeightGrams: number;
  maxWeightGrams: number | null;
}

export async function insertRate(tx: Tx, methodId: string, rate: RateRow): Promise<string> {
  const row = await tx.shippingRate.create({ data: { methodId, ...rate }, select: { id: true } });
  return row.id;
}

export async function getRate(client: DbClient, id: string) {
  return client.shippingRate.findUnique({ where: { id }, select: { id: true, methodId: true, zoneId: true, baseAmount: true, perKgAmount: true, freeAboveSubtotal: true, minWeightGrams: true, maxWeightGrams: true } });
}

export async function deleteRate(tx: Tx, id: string): Promise<void> {
  await tx.shippingRate.delete({ where: { id } });
}

// Checkout ---------------------------------------------------------------------

/** Active methods with an active rate in an active zone covering the province. */
export async function methodsForProvince(client: DbClient, provinceCode: string) {
  const rateWhere = { isActive: true, zone: { isActive: true, regions: { some: { provinceCode, city: null } } } } satisfies Prisma.ShippingRateWhereInput;
  return client.shippingMethod.findMany({
    where: { isActive: true, rates: { some: rateWhere } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      minDeliveryDays: true,
      maxDeliveryDays: true,
      translations: { select: { locale: true, name: true, description: true } },
      rates: {
        where: rateWhere,
        orderBy: [{ minWeightGrams: "asc" }, { id: "asc" }],
        select: { baseAmount: true, perKgAmount: true, freeAboveSubtotal: true, minWeightGrams: true, maxWeightGrams: true },
      },
    },
  });
}
