import { getTranslations } from "next-intl/server";
import type { DisplayUnit } from "@/lib/money";
import type { ProductCard as Card } from "@/modules/catalog/service/storefront";
import { shopAvailability } from "@/modules/inventory/service/stock";
import { ProductCard } from "./product-card";

/** A grid of product cards with their availability (one query for the whole page). */
export async function ProductGrid({ products, locale, unit, empty }: { products: Card[]; locale: "fa" | "en"; unit: DisplayUnit; empty: string }) {
  const t = await getTranslations("Shop");
  if (products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground" data-testid="product-grid-empty">
        {empty}
      </p>
    );
  }
  const availability = await shopAvailability(products.map((p) => p.variantId));
  const labels = { in_stock: t("availability.in_stock"), low: t("availability.low"), out: t("availability.out") };
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} locale={locale} unit={unit} availability={availability.get(p.variantId) ?? "out"} labels={labels} />
      ))}
    </ul>
  );
}
