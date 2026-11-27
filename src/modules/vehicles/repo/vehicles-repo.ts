/**
 * Database access for the motorcycle catalog: manufacturers, brands,
 * models, generations and variants, with their Persian/English names.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { LocalizedName } from "@/lib/i18n/names";
import type { GenerationData, ManufacturerData, ModelData, MotorcycleBrandData, VariantData } from "../domain/vehicle-input";

type Tx = Prisma.TransactionClient;
export type Names = Partial<Record<"fa" | "en", { name: string; slug: string }>>;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function namesOf(rows: { locale: string; name: string; slug?: string }[]): Names {
  const out: Names = {};
  for (const r of rows) if (r.locale === "fa" || r.locale === "en") out[r.locale] = { name: r.name, slug: r.slug ?? "" };
  return out;
}

const nameSelect = { select: { locale: true, name: true, slug: true } } as const;

type NamedTable = "motorcycleManufacturerTranslation" | "motorcycleBrandTranslation" | "motorcycleModelTranslation";
const OWNER_KEY: Record<NamedTable, "manufacturerId" | "brandId" | "modelId"> = {
  motorcycleManufacturerTranslation: "manufacturerId",
  motorcycleBrandTranslation: "brandId",
  motorcycleModelTranslation: "modelId",
};

async function writeNames(tx: Tx, table: NamedTable, ownerId: string, names: LocalizedName[]): Promise<void> {
  const delegate = tx[table] as unknown as { upsert(args: unknown): Promise<unknown>; deleteMany(args: unknown): Promise<unknown> };
  const key = OWNER_KEY[table];
  for (const n of names) {
    await delegate.upsert({
      where: { [`${key}_locale`]: { [key]: ownerId, locale: n.locale } },
      create: { [key]: ownerId, locale: n.locale, name: n.name, slug: n.slug, searchName: n.searchName },
      update: { name: n.name, slug: n.slug, searchName: n.searchName },
    });
  }
  if (!names.some((n) => n.locale === "en")) await delegate.deleteMany({ where: { [key]: ownerId, locale: "en" } });
}

// Manufacturers and brands ----------------------------------------------------

export async function listManufacturersWithBrands(client: DbClient) {
  const rows = await client.motorcycleManufacturer.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      countryCode: true,
      isActive: true,
      translations: nameSelect,
      brands: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, isActive: true, translations: nameSelect, _count: { select: { models: { where: { deletedAt: null } } } } },
      },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    countryCode: m.countryCode,
    isActive: m.isActive,
    names: namesOf(m.translations),
    brands: m.brands.map((b) => ({ id: b.id, isActive: b.isActive, names: namesOf(b.translations), modelCount: b._count.models })),
  }));
}

export async function getManufacturer(client: DbClient, id: string) {
  const row = await client.motorcycleManufacturer.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, countryCode: true, isActive: true, sortOrder: true, translations: nameSelect },
  });
  return row ? { ...row, names: namesOf(row.translations) } : null;
}

export async function insertManufacturer(tx: Tx, data: ManufacturerData): Promise<string> {
  const row = await tx.motorcycleManufacturer.create({ data: { countryCode: data.countryCode, isActive: data.isActive, sortOrder: data.sortOrder }, select: { id: true } });
  await writeNames(tx, "motorcycleManufacturerTranslation", row.id, data.names);
  return row.id;
}

export async function updateManufacturerRow(tx: Tx, id: string, data: ManufacturerData): Promise<void> {
  await tx.motorcycleManufacturer.update({ where: { id }, data: { countryCode: data.countryCode, isActive: data.isActive, sortOrder: data.sortOrder } });
  await writeNames(tx, "motorcycleManufacturerTranslation", id, data.names);
}

export async function getMotorcycleBrand(client: DbClient, id: string) {
  const row = await client.motorcycleBrand.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      manufacturerId: true,
      isActive: true,
      sortOrder: true,
      translations: nameSelect,
      manufacturer: { select: { translations: nameSelect } },
      models: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          segment: true,
          isActive: true,
          translations: nameSelect,
          generations: { orderBy: { yearFrom: "asc" }, select: { yearFrom: true, yearTo: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    manufacturerId: row.manufacturerId,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    names: namesOf(row.translations),
    manufacturerNames: namesOf(row.manufacturer.translations),
    models: row.models.map((m) => ({ id: m.id, segment: m.segment, isActive: m.isActive, names: namesOf(m.translations), generations: m.generations })),
  };
}

export async function manufacturerExists(client: DbClient, id: string): Promise<boolean> {
  return (await client.motorcycleManufacturer.count({ where: { id, deletedAt: null } })) === 1;
}

export async function insertMotorcycleBrand(tx: Tx, data: MotorcycleBrandData): Promise<string> {
  const row = await tx.motorcycleBrand.create({
    data: { manufacturerId: data.manufacturerId, isActive: data.isActive, sortOrder: data.sortOrder },
    select: { id: true },
  });
  await writeNames(tx, "motorcycleBrandTranslation", row.id, data.names);
  return row.id;
}

export async function updateMotorcycleBrandRow(tx: Tx, id: string, data: MotorcycleBrandData): Promise<void> {
  await tx.motorcycleBrand.update({ where: { id }, data: { manufacturerId: data.manufacturerId, isActive: data.isActive, sortOrder: data.sortOrder } });
  await writeNames(tx, "motorcycleBrandTranslation", id, data.names);
}

// Models, generations, variants -------------------------------------------------

export async function brandExists(client: DbClient, id: string): Promise<boolean> {
  return (await client.motorcycleBrand.count({ where: { id, deletedAt: null } })) === 1;
}

export async function getModel(client: DbClient, id: string) {
  const row = await client.motorcycleModel.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      brandId: true,
      segment: true,
      isActive: true,
      sortOrder: true,
      translations: nameSelect,
      brand: { select: { id: true, translations: nameSelect } },
      generations: {
        orderBy: [{ yearFrom: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          code: true,
          yearFrom: true,
          yearTo: true,
          variants: {
            where: { deletedAt: null },
            orderBy: [{ engineDisplacementCc: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              code: true,
              engineDisplacementCc: true,
              engineStroke: true,
              cylinders: true,
              cooling: true,
              fuelSystem: true,
              marketCode: true,
              yearFrom: true,
              yearTo: true,
              isActive: true,
              translations: { select: { locale: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    brandId: row.brandId,
    segment: row.segment,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    names: namesOf(row.translations),
    brand: { id: row.brand.id, names: namesOf(row.brand.translations) },
    generations: row.generations.map((g) => ({ ...g, variants: g.variants.map((v) => ({ ...v, names: namesOf(v.translations) })) })),
  };
}

export async function insertModel(tx: Tx, data: ModelData): Promise<string> {
  const row = await tx.motorcycleModel.create({
    data: { brandId: data.brandId, segment: data.segment, isActive: data.isActive, sortOrder: data.sortOrder },
    select: { id: true },
  });
  await writeNames(tx, "motorcycleModelTranslation", row.id, data.names);
  return row.id;
}

export async function updateModelRow(tx: Tx, id: string, data: ModelData): Promise<void> {
  await tx.motorcycleModel.update({ where: { id }, data: { brandId: data.brandId, segment: data.segment, isActive: data.isActive, sortOrder: data.sortOrder } });
  await writeNames(tx, "motorcycleModelTranslation", id, data.names);
}

export async function getGeneration(client: DbClient, id: string) {
  return client.motorcycleGeneration.findFirst({ where: { id }, select: { id: true, modelId: true, code: true, yearFrom: true, yearTo: true } });
}

export async function insertGeneration(tx: Tx, modelId: string, data: GenerationData): Promise<string> {
  const row = await tx.motorcycleGeneration.create({ data: { modelId, code: data.code, yearFrom: data.yearFrom, yearTo: data.yearTo }, select: { id: true } });
  return row.id;
}

export async function updateGenerationRow(tx: Tx, id: string, data: GenerationData): Promise<void> {
  await tx.motorcycleGeneration.update({ where: { id }, data: { code: data.code, yearFrom: data.yearFrom, yearTo: data.yearTo } });
}

export async function getMotorcycleVariant(client: DbClient, id: string) {
  return client.motorcycleVariant.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, generationId: true, generation: { select: { modelId: true } } },
  });
}

async function writeVariantNames(tx: Tx, variantId: string, data: VariantData): Promise<void> {
  const rows = [{ locale: "fa", name: data.faName }, ...(data.enName ? [{ locale: "en", name: data.enName }] : [])];
  for (const r of rows) {
    await tx.motorcycleVariantTranslation.upsert({
      where: { variantId_locale: { variantId, locale: r.locale } },
      create: { variantId, locale: r.locale, name: r.name },
      update: { name: r.name },
    });
  }
  if (!data.enName) await tx.motorcycleVariantTranslation.deleteMany({ where: { variantId, locale: "en" } });
}

const variantColumns = (data: VariantData) => ({
  generationId: data.generationId,
  code: data.code,
  engineDisplacementCc: data.engineDisplacementCc,
  engineStroke: data.engineStroke,
  cylinders: data.cylinders,
  cooling: data.cooling,
  fuelSystem: data.fuelSystem,
  marketCode: data.marketCode,
  yearFrom: data.yearFrom,
  yearTo: data.yearTo,
  isActive: data.isActive,
});

export async function insertMotorcycleVariant(tx: Tx, data: VariantData): Promise<string> {
  const row = await tx.motorcycleVariant.create({ data: variantColumns(data), select: { id: true } });
  await writeVariantNames(tx, row.id, data);
  return row.id;
}

export async function updateMotorcycleVariantRow(tx: Tx, id: string, data: VariantData): Promise<void> {
  await tx.motorcycleVariant.update({ where: { id }, data: variantColumns(data) });
  await writeVariantNames(tx, id, data);
}

/**
 * Everything the fitment picker offers: each active model with its brand,
 * generations and variants (names in both languages).
 */
export async function motorcyclePickerRows(client: DbClient) {
  const models = await client.motorcycleModel.findMany({
    where: { deletedAt: null, brand: { deletedAt: null } },
    orderBy: [{ brand: { sortOrder: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      isActive: true,
      translations: nameSelect,
      brand: { select: { translations: nameSelect } },
      generations: {
        orderBy: { yearFrom: "asc" },
        select: {
          id: true,
          code: true,
          yearFrom: true,
          yearTo: true,
          variants: {
            where: { deletedAt: null },
            orderBy: { engineDisplacementCc: "asc" },
            select: { id: true, engineDisplacementCc: true, yearFrom: true, yearTo: true, translations: { select: { locale: true, name: true } } },
          },
        },
      },
    },
  });
  return models.map((m) => ({
    id: m.id,
    isActive: m.isActive,
    names: namesOf(m.translations),
    brandNames: namesOf(m.brand.translations),
    generations: m.generations.map((g) => ({ ...g, variants: g.variants.map((v) => ({ ...v, names: namesOf(v.translations) })) })),
  }));
}
