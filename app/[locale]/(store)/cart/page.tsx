import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogImage, ImagePlaceholder } from "@/components/media/catalog-image";
import { Price } from "@/components/store/price";
import { shopLocale } from "@/components/store/shop-locale";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { updateCartLineAction } from "@/modules/sales/api/cart-actions";
import { cartOwner } from "@/modules/sales/api/cart-owner";
import { viewCart } from "@/modules/sales/service/cart";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Cart" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const [t, unit, cart] = await Promise.all([getTranslations("Cart"), getDisplayUnit(), cartOwner().then((owner) => viewCart(owner, locale))]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-extrabold">{t("title")}</h1>
      {cart.lines.length === 0 ? (
        <div className="space-y-3 rounded-lg border p-6 text-center" data-testid="cart-empty">
          <p>{t("empty")}</p>
          <Button asChild variant="outline">
            <Link href="/">{t("continue")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
          <ul className="divide-y rounded-lg border" data-testid="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.variantId} className="flex gap-3 p-3" data-testid="cart-line">
                <div className="w-20 shrink-0">
                  {line.item && line.item.image.renditions.length > 0 ? (
                    <CatalogImage renditions={line.item.image.renditions} alt={line.item.image.alt} sizes="80px" width={320} className="aspect-square rounded-md border" />
                  ) : (
                    <ImagePlaceholder label={line.item?.title ?? ""} className="rounded-md border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {line.item ? (
                    <Link href={`/p/${line.item.slug}`} className="font-semibold hover:underline" data-testid="cart-line-title">
                      {line.item.title}
                    </Link>
                  ) : (
                    <p className="font-semibold text-muted-foreground">{t("unavailableItem")}</p>
                  )}
                  {line.item ? (
                    <p className="text-sm text-muted-foreground">
                      <span dir="ltr">{line.item.sku}</span> · <Price amount={line.item.price} compareAt={line.item.compareAtPrice} locale={locale} unit={unit} />
                    </p>
                  ) : null}
                  {line.problem ? (
                    <p role="alert" className="text-sm text-destructive" data-testid="cart-line-problem">
                      {t(`problems.${line.problem}`, { min: formatCount(line.item?.minQty ?? 1, locale), max: formatCount(line.item?.maxQty ?? 0, locale) })}
                    </p>
                  ) : null}
                  <form action={updateCartLineAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="variantId" value={line.variantId} />
                    {line.item ? (
                      <>
                        <label className="sr-only" htmlFor={`qty-${line.variantId}`}>
                          {t("quantity")}
                        </label>
                        <input
                          id={`qty-${line.variantId}`}
                          name="quantity"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={99}
                          defaultValue={line.quantity}
                          dir="ltr"
                          className="h-10 w-20 rounded-md border border-input bg-background px-3"
                          data-testid="cart-line-quantity"
                        />
                        <Button type="submit" name="intent" value="update" variant="outline" size="sm" data-testid="cart-line-update">
                          {t("update")}
                        </Button>
                      </>
                    ) : null}
                    <Button type="submit" name="intent" value="remove" variant="ghost" size="sm" data-testid="cart-line-remove">
                      {t("remove")}
                    </Button>
                  </form>
                </div>
                <div className="shrink-0 text-end font-bold" data-testid="cart-line-total">
                  {line.lineTotal !== null ? formatMoney(line.lineTotal, { locale, unit }) : "—"}
                </div>
              </li>
            ))}
          </ul>
          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4" data-testid="cart-summary">
            <div className="flex items-baseline justify-between gap-2">
              <span>{t("subtotal")}</span>
              <span className="text-lg font-extrabold" data-testid="cart-subtotal">
                {formatMoney(cart.subtotal, { locale, unit })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("shippingLater")}</p>
            {cart.ready ? null : (
              <p className="text-sm text-destructive" data-testid="cart-not-ready">
                {t("fixProblems")}
              </p>
            )}
            {cart.ready ? (
              <Button asChild className="w-full" data-testid="cart-checkout">
                <Link href="/checkout">{t("checkout")}</Link>
              </Button>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
