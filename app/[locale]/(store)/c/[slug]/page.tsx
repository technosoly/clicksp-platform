import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Pagination } from "@/components/store/pagination";
import { ProductGrid } from "@/components/store/product-grid";
import { shopLocale } from "@/components/store/shop-locale";
import { CategoryTile } from "@/components/store/tile";
import { formatCount } from "@/lib/i18n/numbers";
import { categoryPage, pageNumber } from "@/modules/catalog/service/storefront";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { alternatesFor } from "@/components/store/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await categoryPage(shopLocale(locale), decodeURIComponent(slug), 1);
  if (!category) return {};
  return { title: category.name, alternates: alternatesFor(shopLocale(locale), "c", category.alternates) };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const page = pageNumber((await searchParams).page);
  const category = await categoryPage(locale, decodeURIComponent(slug), page);
  if (!category) notFound();
  const [t, unit] = await Promise.all([getTranslations("Shop"), getDisplayUnit()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[...category.crumbs.map((c) => ({ name: c.name, href: `/c/${c.slug}` })), { name: category.name }]} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold" data-testid="category-heading">
          {category.name}
        </h1>
        <span className="text-sm text-muted-foreground">{t("productCount", { count: formatCount(category.total, locale) })}</span>
      </div>
      {category.children.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {category.children.map((c) => (
            <CategoryTile key={c.id} name={c.name} href={`/c/${c.slug}`} renditions={c.renditions} />
          ))}
        </ul>
      ) : null}
      <ProductGrid products={category.products} locale={locale} unit={unit} empty={t("categoryEmpty")} />
      <Pagination path={`/c/${category.slug}`} params={{}} page={page} pages={category.pages} locale={locale} />
    </div>
  );
}
