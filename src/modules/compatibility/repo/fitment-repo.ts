/** Database access for fitment links (product_compatibilities) and their sources. */
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import type { FitmentData, NewSource, VerificationStatusKey } from "../domain/fitment-input";

type Tx = Prisma.TransactionClient;
type Names = Partial<Record<"fa" | "en", string>>;

const names = (rows: { locale: string; name: string }[]): Names => Object.fromEntries(rows.filter((r) => r.locale === "fa" || r.locale === "en").map((r) => [r.locale, r.name]));
const nameSelect = { select: { locale: true, name: true } } as const;
const generationSelect = {
  select: {
    id: true,
    code: true,
    yearFrom: true,
    yearTo: true,
    model: { select: { id: true, translations: nameSelect, brand: { select: { translations: nameSelect } } } },
  },
} as const;

export async function listFitment(client: DbClient, productId: string) {
  const rows = await client.productCompatibility.findMany({
    where: { productId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      yearFrom: true,
      yearTo: true,
      position: true,
      quantityPerVehicle: true,
      notes: true,
      verificationStatus: true,
      verifiedAt: true,
      source: { select: { id: true, type: true, title: true, reference: true, url: true } },
      verifiedBy: { select: { name: true, username: true } },
      motorcycleGeneration: generationSelect,
      motorcycleVariant: { select: { id: true, engineDisplacementCc: true, translations: nameSelect, generation: generationSelect } },
    },
  });
  return rows.map((r) => {
    const generation = r.motorcycleGeneration ?? r.motorcycleVariant!.generation;
    return {
      id: r.id,
      yearFrom: r.yearFrom,
      yearTo: r.yearTo,
      position: r.position,
      quantity: r.quantityPerVehicle,
      notes: r.notes,
      status: r.verificationStatus as VerificationStatusKey,
      verifiedAt: r.verifiedAt,
      verifiedBy: r.verifiedBy ? r.verifiedBy.name || r.verifiedBy.username : null,
      source: r.source,
      motorcycle: {
        brand: names(generation.model.brand.translations),
        model: names(generation.model.translations),
        modelId: generation.model.id,
        generation: { code: generation.code, yearFrom: generation.yearFrom, yearTo: generation.yearTo },
        variant: r.motorcycleVariant ? { name: names(r.motorcycleVariant.translations), cc: r.motorcycleVariant.engineDisplacementCc } : null,
      },
    };
  });
}

export async function getFitment(client: DbClient, productId: string, id: string) {
  return client.productCompatibility.findFirst({ where: { id, productId }, select: { id: true, verificationStatus: true, sourceId: true } });
}

export async function generationExists(client: DbClient, id: string): Promise<boolean> {
  return (await client.motorcycleGeneration.count({ where: { id, model: { deletedAt: null } } })) === 1;
}

export async function variantExists(client: DbClient, id: string): Promise<boolean> {
  return (await client.motorcycleVariant.count({ where: { id, deletedAt: null } })) === 1;
}

export async function sourceExists(client: DbClient, id: string): Promise<boolean> {
  return (await client.compatibilitySource.count({ where: { id } })) === 1;
}

export async function insertSource(tx: Tx, source: NewSource, createdById: string): Promise<string> {
  const row = await tx.compatibilitySource.create({
    data: { type: source.type, title: source.title, reference: source.reference, url: source.url, createdById },
    select: { id: true },
  });
  return row.id;
}

export async function listSources(client: DbClient) {
  return client.compatibilitySource.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, type: true, title: true, reference: true },
  });
}

export async function insertFitment(tx: Tx, productId: string, data: FitmentData, sourceId: string, createdById: string): Promise<string> {
  const row = await tx.productCompatibility.create({
    data: {
      productId,
      motorcycleVariantId: "variantId" in data.target ? data.target.variantId : null,
      motorcycleGenerationId: "generationId" in data.target ? data.target.generationId : null,
      yearFrom: data.yearFrom,
      yearTo: data.yearTo,
      position: data.position,
      quantityPerVehicle: data.quantity,
      notes: data.notes,
      sourceId,
      // New links always start unverified.
      verificationStatus: "unverified",
      createdById,
    },
    select: { id: true },
  });
  return row.id;
}

export async function setFitmentStatus(tx: Tx, id: string, status: VerificationStatusKey, by: string, at: Date): Promise<void> {
  await tx.productCompatibility.update({
    where: { id },
    data: status === "verified" ? { verificationStatus: status, verifiedById: by, verifiedAt: at } : { verificationStatus: status, verifiedById: null, verifiedAt: null },
  });
}

export async function deleteFitment(tx: Tx, productId: string, id: string): Promise<boolean> {
  const { count } = await tx.productCompatibility.deleteMany({ where: { id, productId } });
  return count === 1;
}
