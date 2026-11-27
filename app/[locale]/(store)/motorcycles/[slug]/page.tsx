import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Pagination } from "@/components/store/pagination";
import { ProductGrid } from "@/components/store/product-grid";
import { alternatesFor } from "@/components/store/seo";
import { shopLocale, slugParam } from "@/components/store/shop-locale";
import { jalaliModelYear } from "@/lib/i18n/model-year";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import { pageNumber, productCardsByIds } from "@/modules/catalog/service/storefront";
import { fitmentChoice, productIdsFitting } from "@/modules/compatibility/service/shop-fitment";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { shopMotorcycleModel } from "@/modules/vehicles/service/shop";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const model = await shopMotorcycleModel(shopLocale(locale), slugParam(slug));
  if (!model) return {};
  const t = await getTranslations("Shop");
  return { title: t("partsFor", { bike: `${model.brand} ${model.name}` }), alternates: alternatesFor(shopLocale(locale), "motorcycles", model.alternates) };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function MotorcycleModelPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const model = await shopMotorcycleModel(locale, slugParam(slug));
  if (!model) notFound();
  const sp = await searchParams;
  const page = pageNumber(sp.page);
  // Only this model's own generations and engine versions count.
  const choice = fitmentChoice({ g: one(sp.g), v: one(sp.v), y: one(sp.y) });
  const generation = model.generations.find((g) => g.id === choice.generationId) ?? null;
  const variant = generation?.variants.find((v) => v.id === choice.variantId) ?? null;
  const ids = await productIdsFitting(model.id, { generationId: generation?.id ?? null, variantId: variant?.id ?? null, year: choice.year });
  const [t, unit, result] = await Promise.all([getTranslations("Shop"), getDisplayUnit(), productCardsByIds(locale, ids, page)]);

  const year = (y: number) => (locale === "fa" ? String(jalaliModelYear(y)) : String(y));
  const range = (from: number, to: number | null) => (to === null ? t("yearsFrom", { from: year(from) }) : `${year(from)}–${year(to)}`);
  const bike = `${model.brand} ${model.name}`;
  const base = `/motorcycles/${model.slug}`;
  const query: Record<string, string> = {
    ...(generation ? { g: generation.id } : {}),
    ...(variant ? { v: variant.id } : {}),
    ...(choice.year ? { y: String(choice.year) } : {}),
  };
  const chip = (active: boolean) => cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm", active ? "border-brand-orange bg-accent font-semibold" : "hover:border-brand-orange");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[{ name: t("byMotorcycle"), href: "/motorcycles" }, { name: bike }]} />
      <h1 className="text-2xl font-extrabold" data-testid="motorcycle-heading">
        {t("partsFor", { bike })}
      </h1>

      <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t("chooseYourBike")}>
        <h2 className="font-semibold">{t("modelYears")}</h2>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={base} className={chip(!generation)}>
              {t("allYears")}
            </Link>
          </li>
          {model.generations.map((g) => (
            <li key={g.id}>
              <Link href={`${base}?g=${g.id}`} className={chip(generation?.id === g.id)} data-testid="motorcycle-generation">
                {[g.code, range(g.yearFrom, g.yearTo)].filter(Boolean).join(" · ")}
              </Link>
            </li>
          ))}
        </ul>
        {generation && generation.variants.length > 0 ? (
          <>
            <h2 className="font-semibold">{t("engineVersion")}</h2>
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href={`${base}?g=${generation.id}`} className={chip(!variant)}>
                  {t("allVersions")}
                </Link>
              </li>
              {generation.variants.map((v) => (
                <li key={v.id}>
                  <Link href={`${base}?g=${generation.id}&v=${v.id}`} className={chip(variant?.id === v.id)} data-testid="motorcycle-variant">
                    {[v.name, v.cc ? t("cc", { cc: formatCount(v.cc, locale) }) : null].filter(Boolean).join(" · ")}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <form method="get" action={`/${locale}${base}`} className="flex flex-wrap items-end gap-2">
          {generation ? <input type="hidden" name="g" value={generation.id} /> : null}
          {variant ? <input type="hidden" name="v" value={variant.id} /> : null}
          <label className="text-sm">
            <span className="mb-1 block font-semibold">{t("exactYear")}</span>
            <input name="y" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={choice.year ? year(choice.year) : ""} placeholder={t("yearPlaceholder")} className="h-11 w-28 rounded-md border border-input bg-background px-3" />
          </label>
          <button type="submit" className="h-11 rounded-md border px-4 text-sm hover:bg-accent">
            {t("apply")}
          </button>
        </form>
      </section>

      <p className="text-sm text-muted-foreground" data-testid="motorcycle-summary">
        {t("verifiedPartsCount", { count: formatCount(result.total, locale) })}
      </p>
      <ProductGrid products={result.products} locale={locale} unit={unit} empty={t("motorcyclePartsEmpty")} />
      <Pagination path={base} params={query} page={page} pages={result.pages} locale={locale} />
    </div>
  );
}
