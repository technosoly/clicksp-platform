import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HeroSlider, type HeroSlide } from "@/components/store/hero-slider";
import { ProductGrid } from "@/components/store/product-grid";
import { SearchForm } from "@/components/store/search-form";
import { shopLocale } from "@/components/store/shop-locale";
import { CategoryTile } from "@/components/store/tile";
import { Link } from "@/lib/i18n/navigation";
import { shopHome } from "@/modules/catalog/service/storefront";
import { shopBanners } from "@/modules/content/service/banners";
import { mediaUrl, pickRendition, srcSet } from "@/modules/media/domain/image-rules";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { shopMotorcycleBrands } from "@/modules/vehicles/service/shop";

// Catalog data changes from the admin; render per request.
export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const [t, home, brands, unit, banners] = await Promise.all([getTranslations("Home"), shopHome(locale), shopMotorcycleBrands(locale), getDisplayUnit(), shopBanners(locale)]);
  const ts = await getTranslations("Shop");
  const slides: HeroSlide[] = banners.flatMap((b) => {
    const main = pickRendition(b.desktop, 1280);
    if (!main) return [];
    return [{ ...b, desktop: { src: mediaUrl(main.key), srcSet: srcSet(b.desktop), width: main.width, height: main.height }, mobile: b.mobile.length ? { srcSet: srcSet(b.mobile) } : null }];
  });

  return (
    <>
      <HeroSlider slides={slides} />
      <section className="bg-brand-charcoal text-brand-cream">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 text-center sm:py-14 md:flex-row md:text-start">
          <Image src="/brand/logo-badge.webp" alt="" width={176} height={176} priority className="size-28 shrink-0 sm:size-44" />
          <div className="w-full space-y-4">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl" data-testid="home-heading">
              {t("heading")}
            </h1>
            <p className="text-lg text-brand-cream/90">{t("subheading")}</p>
            <SearchForm className="max-w-xl" testId="home-search" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        <section aria-labelledby="bikes-heading" className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="bikes-heading" className="text-xl font-bold">
              {ts("byMotorcycle")}
            </h2>
            <Link href="/motorcycles" className="text-sm text-brand-orange-strong underline">
              {ts("allMotorcycles")}
            </Link>
          </div>
          {brands.length === 0 ? (
            <p className="text-muted-foreground" data-testid="home-bikes-empty">
              {ts("motorcyclesEmpty")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" data-testid="home-bikes">
              {brands.flatMap((b) =>
                b.models.slice(0, 12).map((m) => (
                  <li key={m.id}>
                    <Link href={`/motorcycles/${m.slug}`} className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm hover:border-brand-orange">
                      {`${b.name} ${m.name}`}
                    </Link>
                  </li>
                )),
              )}
            </ul>
          )}
        </section>

        <section aria-labelledby="categories-heading" className="space-y-3">
          <h2 id="categories-heading" className="text-xl font-bold">
            {ts("categories")}
          </h2>
          {home.categories.length === 0 ? (
            <p className="text-muted-foreground" data-testid="home-categories-empty">
              {ts("categoriesEmpty")}
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {home.categories.map((c) => (
                <CategoryTile key={c.id} name={c.name} href={`/c/${c.slug}`} renditions={c.renditions} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="latest-heading" className="space-y-3">
          <h2 id="latest-heading" className="text-xl font-bold">
            {ts("latest")}
          </h2>
          <ProductGrid products={home.latest} locale={locale} unit={unit} empty={ts("productsEmpty")} />
        </section>
      </div>
    </>
  );
}
