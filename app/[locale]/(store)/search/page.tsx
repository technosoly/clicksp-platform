import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pagination } from "@/components/store/pagination";
import { ProductGrid } from "@/components/store/product-grid";
import { SearchForm } from "@/components/store/search-form";
import { shopLocale } from "@/components/store/shop-locale";
import { formatCount } from "@/lib/i18n/numbers";
import { pageNumber } from "@/modules/catalog/service/storefront";
import { searchStore } from "@/modules/search/service/product-search";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Shop");
  // Search results are not indexed.
  return { title: t("searchTitle"), robots: { index: false, follow: true } };
}

export default async function SearchPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = pageNumber(sp.page);
  const [t, result, unit] = await Promise.all([getTranslations("Shop"), searchStore(locale, q, page), getDisplayUnit()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-extrabold">{t("searchTitle")}</h1>
      <SearchForm defaultValue={result.query} className="max-w-xl" testId="search-page" />
      {result.query.length >= 2 ? (
        <p className="text-sm text-muted-foreground" data-testid="search-summary">
          {t("searchResults", { count: formatCount(result.total, locale), query: result.query })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("searchHint")}</p>
      )}
      {result.query.length >= 2 ? <ProductGrid products={result.products} locale={locale} unit={unit} empty={t("searchEmpty")} /> : null}
      <Pagination path="/search" params={{ q: result.query }} page={page} pages={result.pages} locale={locale} />
    </div>
  );
}
