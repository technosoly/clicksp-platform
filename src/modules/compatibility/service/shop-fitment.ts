import "server-only";
import { db } from "@/lib/db";
import { toEnDigits } from "@/lib/persian-text";
import { parseModelYear } from "@/lib/i18n/model-year";
import { verifiedFitmentRows, verifiedProductIdsFor } from "../repo/fitment-repo";

/**
 * Fitment for the storefront. Only **verified** links are ever shown or used
 * to find parts: unverified, disputed and rejected links stay in the admin.
 * No actor: this is public information about published parts.
 */

type Locale = "fa" | "en";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRODUCTS = 5000;
const pick = <T extends { locale: string }>(rows: readonly T[], locale: Locale) => rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "fa") ?? rows[0];

/** The motorcycles a published product is verified to fit. */
export async function shopFitment(locale: Locale, productId: string) {
  if (!UUID.test(productId)) return [];
  const rows = await verifiedFitmentRows(db(), productId);
  return rows.flatMap((r) => {
    const generation = r.motorcycleVariant?.generation ?? r.motorcycleGeneration;
    if (!generation) return [];
    const model = pick(generation.model.translations, locale);
    const variant = r.motorcycleVariant;
    const from = r.yearFrom ?? variant?.yearFrom ?? generation.yearFrom;
    const to = r.yearFrom !== null ? (r.yearTo ?? r.yearFrom) : (variant?.yearTo ?? generation.yearTo);
    return [
      {
        brand: pick(generation.model.brand.translations, locale)?.name ?? "",
        model: model?.name ?? "",
        modelSlug: model?.slug ?? "",
        variant: variant ? (pick(variant.translations, locale)?.name ?? "") : null,
        cc: variant?.engineDisplacementCc ?? null,
        yearFrom: from,
        yearTo: to,
        position: r.position,
        quantity: r.quantityPerVehicle,
      },
    ];
  });
}

/** Parses the finder's choices from the URL; anything malformed is ignored. */
export function fitmentChoice(params: { g?: string; v?: string; y?: string }) {
  const generationId = params.g && UUID.test(params.g) ? params.g : null;
  const variantId = params.v && UUID.test(params.v) ? params.v : null;
  const parsedYear = params.y ? parseModelYear(toEnDigits(params.y)) : null;
  const year = typeof parsedYear === "number" ? parsedYear : null;
  return { generationId, variantId, year };
}

/** Ids of products verified to fit the chosen motorcycle (published filtering is the catalog's job). */
export async function productIdsFitting(modelId: string, choice: ReturnType<typeof fitmentChoice>): Promise<string[]> {
  if (!UUID.test(modelId)) return [];
  return verifiedProductIdsFor(db(), { modelId, ...choice }, MAX_PRODUCTS);
}
