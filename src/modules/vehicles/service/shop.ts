import "server-only";
import { db } from "@/lib/db";
import { shopBrandsWithModels, shopModel, shopModelIdBySlug } from "../repo/vehicles-repo";

/**
 * The public motorcycle catalog for "find parts for my bike". No actor:
 * only active makers, brands, models and engine versions, and only their
 * names and years, are returned.
 */

type Locale = "fa" | "en";
const pick = <T extends { locale: string }>(rows: readonly T[], locale: Locale) => rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "fa") ?? rows[0];

export async function shopMotorcycleBrands(locale: Locale) {
  const brands = await shopBrandsWithModels(db());
  return brands.map((b) => ({
    id: b.id,
    name: pick(b.translations, locale)?.name ?? "",
    models: b.models.map((m) => {
      const t = pick(m.translations, locale);
      return { id: m.id, name: t?.name ?? "", slug: t?.slug ?? "" };
    }),
  }));
}

export async function shopMotorcycleModel(locale: Locale, slug: string) {
  const matches = await shopModelIdBySlug(db(), slug.slice(0, 160));
  const match = matches.find((m) => m.locale === locale) ?? matches[0];
  if (!match) return null;
  const model = await shopModel(db(), match.modelId);
  if (!model) return null;
  const t = pick(model.translations, locale);
  return {
    id: model.id,
    name: t?.name ?? "",
    slug: t?.slug ?? slug,
    alternates: Object.fromEntries(model.translations.map((x) => [x.locale, x.slug])) as Partial<Record<Locale, string>>,
    brand: pick(model.brand.translations, locale)?.name ?? "",
    generations: model.generations.map((g) => ({
      id: g.id,
      code: g.code,
      yearFrom: g.yearFrom,
      yearTo: g.yearTo,
      variants: g.variants.map((v) => ({ id: v.id, name: pick(v.translations, locale)?.name ?? "", cc: v.engineDisplacementCc, yearFrom: v.yearFrom, yearTo: v.yearTo })),
    })),
  };
}

/** Public addresses of motorcycle models, per language that has its own address (sitemap). */
export async function motorcycleSitemap() {
  const brands = await shopBrandsWithModels(db());
  return brands.flatMap((b) =>
    b.models.flatMap((m) => m.translations.flatMap((t) => (t.slug && (t.locale === "fa" || t.locale === "en") ? [{ path: `/motorcycles/${t.slug}`, locale: t.locale as "fa" | "en", updatedAt: null }] : []))),
  );
}
