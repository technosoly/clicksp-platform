import { CatalogImage } from "@/components/media/catalog-image";
import { Link } from "@/lib/i18n/navigation";
import type { DisplayUnit } from "@/lib/money";
import type { ProductCard as Card } from "@/modules/catalog/service/storefront";
import { Price } from "./price";

/** One product in a grid: photo (or placeholder), title, brand, price, availability. */
export function ProductCard({ product, locale, unit, availability, labels }: {
  product: Card;
  locale: "fa" | "en";
  unit: DisplayUnit;
  availability: "in_stock" | "low" | "out";
  labels: Record<"in_stock" | "low" | "out", string>;
}) {
  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-brand-orange" data-testid="product-card">
      <Link href={`/p/${product.slug}`} className="flex flex-1 flex-col">
        <CatalogImage renditions={product.image.renditions} alt={product.image.alt} sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw" width={320} className="aspect-square" />
        <div className="flex flex-1 flex-col gap-1 p-3">
          {product.brand ? <span className="text-xs text-muted-foreground">{product.brand}</span> : null}
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-brand-orange-strong" data-testid="product-card-title">
            {product.title}
          </h3>
          <span dir="ltr" className="text-start text-xs text-muted-foreground">
            {product.sku}
          </span>
          <div className="mt-auto pt-2">
            <Price amount={product.price} compareAt={product.compareAtPrice} locale={locale} unit={unit} />
            <span className={availability === "out" ? "text-xs text-destructive" : availability === "low" ? "text-xs text-brand-orange-strong" : "text-xs text-success"} data-testid="product-card-availability">
              {labels[availability]}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
