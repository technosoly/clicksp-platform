import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogImage, ImagePlaceholder } from "@/components/media/catalog-image";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Price } from "@/components/store/price";
import { alternatesFor } from "@/components/store/seo";
import { shopLocale } from "@/components/store/shop-locale";
import { formatCount } from "@/lib/i18n/numbers";
import { jalaliModelYear } from "@/lib/i18n/model-year";
import { Link } from "@/lib/i18n/navigation";
import { productPage } from "@/modules/catalog/service/storefront";
import { shopFitment } from "@/modules/compatibility/service/shop-fitment";
import { shopAvailability } from "@/modules/inventory/service/stock";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await productPage(shopLocale(locale), decodeURIComponent(slug));
  if (!product) return {};
  return {
    title: product.title,
    description: product.shortDescription ?? undefined,
    alternates: alternatesFor(shopLocale(locale), "p", product.alternates),
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const product = await productPage(locale, decodeURIComponent(slug));
  if (!product) notFound();
  const [t, unit, fitment, availability] = await Promise.all([
    getTranslations("Shop"),
    getDisplayUnit(),
    shopFitment(locale, product.id),
    shopAvailability(product.variants.map((v) => v.id)),
  ]);
  const main = product.variants[0]!;
  const status = availability.get(main.id) ?? "out";
  const year = (y: number) => (locale === "fa" ? formatCount(jalaliModelYear(y), "fa").replace(/٬/g, "") : String(y));
  const years = (from: number, to: number | null) => (to === null ? t("yearsFrom", { from: year(from) }) : from === to ? year(from) : `${year(from)}–${year(to)}`);
  const [cover, ...more] = product.images;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[...(product.category ? [{ name: product.category.name, href: `/c/${product.category.slug}` }] : []), { name: product.title }]} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2" data-testid="product-gallery">
          {cover ? (
            <CatalogImage renditions={cover.renditions} alt={cover.alt} sizes="(min-width: 768px) 560px, 100vw" width={1200} priority className="aspect-square rounded-lg border" testId="product-photo" />
          ) : (
            <ImagePlaceholder label={product.title} className="rounded-lg border" testId="product-photo" />
          )}
          {more.length > 0 ? (
            <ul className="grid grid-cols-4 gap-2">
              {more.map((img) => (
                <li key={img.id}>
                  <CatalogImage renditions={img.renditions} alt={img.alt} sizes="140px" width={320} className="aspect-square rounded-md border" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-4">
          {product.brand ? (
            <p className="text-sm text-muted-foreground">
              {product.brand.name}
              {product.brand.isGenuine ? <span className="ms-2 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">{t("genuine")}</span> : null}
            </p>
          ) : null}
          <h1 className="text-2xl font-extrabold leading-snug" data-testid="product-title">
            {product.title}
          </h1>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("sku")}</dt>
            <dd dir="ltr" className="text-start" data-testid="product-sku">
              {main.sku}
            </dd>
            {product.identifiers.map((i) => (
              <div key={`${i.type}-${i.value}`} className="contents">
                <dt className="text-muted-foreground">{t(`identifierTypes.${i.type}`)}</dt>
                <dd dir="ltr" className="text-start">
                  {i.value}
                </dd>
              </div>
            ))}
            {product.warrantyMonths ? (
              <>
                <dt className="text-muted-foreground">{t("warranty")}</dt>
                <dd>{t("warrantyMonths", { months: formatCount(product.warrantyMonths, locale) })}</dd>
              </>
            ) : null}
          </dl>
          <div className="space-y-1 rounded-lg border bg-card p-4">
            <Price amount={main.price} compareAt={main.compareAtPrice} locale={locale} unit={unit} size="lg" testId="product-price" />
            <p className={status === "out" ? "text-sm text-destructive" : status === "low" ? "text-sm text-brand-orange-strong" : "text-sm text-success"} data-testid="product-availability">
              {t(`availability.${status}`)}
            </p>
            <p className="text-xs text-muted-foreground">{t("orderingSoon")}</p>
          </div>
          {product.shortDescription ? <p className="leading-relaxed">{product.shortDescription}</p> : null}
          {product.variants.length > 1 ? (
            <div>
              <h2 className="mb-2 font-semibold">{t("otherVersions")}</h2>
              <ul className="divide-y rounded-lg border text-sm">
                {product.variants.slice(1).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span dir="ltr">{v.sku}</span>
                    <Price amount={v.price} compareAt={v.compareAtPrice} locale={locale} unit={unit} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="fits-heading" className="space-y-3 rounded-lg border p-4" data-testid="product-fitment">
        <h2 id="fits-heading" className="text-lg font-bold">
          {t("fitsTitle")}
        </h2>
        {fitment.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="product-fitment-empty">
            {t("fitsEmpty")}
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {fitment.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="product-fitment-row">
                <Link href={`/motorcycles/${f.modelSlug}`} className="font-semibold hover:underline">{`${f.brand} ${f.model}`}</Link>
                <span>{years(f.yearFrom, f.yearTo)}</span>
                {f.variant ? <span className="text-muted-foreground">{[f.variant, f.cc ? t("cc", { cc: formatCount(f.cc, locale) }) : null].filter(Boolean).join(" · ")}</span> : null}
                {f.position !== "any" ? <span className="text-muted-foreground">{t(`positions.${f.position}`)}</span> : null}
                {f.quantity ? <span className="text-muted-foreground">{t("perBike", { count: formatCount(f.quantity, locale) })}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("fitsNote")}</p>
      </section>
    </div>
  );
}
