import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { CategoryOptions, money } from "@/components/admin/catalog-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { PRODUCT_STATUSES } from "@/modules/catalog/domain/catalog-input";
import { categoryOptions } from "@/modules/catalog/service/categories";
import { listProductsForAdmin } from "@/modules/catalog/service/products";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

const STATUS_TONE = { draft: "neutral", active: "success", archived: "danger" } as const;

export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
  const query = { q: one("q"), status: one("status"), categoryId: one("category"), page: one("page") };
  const { data } = await adminPage(
    locale,
    async (actor) => {
      const list = await listProductsForAdmin(actor, query);
      return { list, categories: await categoryOptions(actor, "product.view"), unit: await getDisplayUnit() };
    },
    "/admin/products",
  );
  const t = await getTranslations("AdminCatalog");
  const { list } = data;
  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    if (query.q) p.set("q", query.q);
    if (query.status) p.set("status", query.status);
    if (query.categoryId) p.set("category", query.categoryId);
    p.set("page", String(page));
    return `/admin/products?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={t("productsTitle")}
        description={t("productsIntro")}
        testId="admin-products-heading"
        actions={
          list.canCreate ? (
            <Button asChild data-testid="admin-product-new-link">
              <Link href="/admin/products/new">{t("newProduct")}</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]" role="search" data-testid="admin-products-filter">
          <Input name="q" defaultValue={query.q ?? ""} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} maxLength={100} />
          <select name="status" defaultValue={query.status ?? ""} className={selectClass} aria-label={t("fields.status")}>
            <option value="">{t("allStatuses")}</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
          <select name="category" defaultValue={query.categoryId ?? ""} className={selectClass} aria-label={t("fields.primaryCategory")}>
            <option value="">{t("allCategories")}</option>
            <CategoryOptions categories={data.categories} locale={locale} inactiveLabel={t("inactive")} />
          </select>
          <Button type="submit" variant="secondary">
            {t("search")}
          </Button>
        </form>
      </Card>
      <Card>
        {list.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-products-empty">
            {t("productsEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-products-table">
              <thead>
                <tr className="border-b text-start text-xs text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t("fields.title")}</th>
                  <th className="py-2 text-start font-medium">{t("fields.sku")}</th>
                  <th className="py-2 text-start font-medium">{t("fields.price")}</th>
                  <th className="py-2 text-start font-medium">{t("fields.primaryCategory")}</th>
                  <th className="py-2 text-start font-medium">{t("fields.status")}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" data-testid="admin-product-row">
                    <td className="py-2 pe-3">
                      <Link href={`/admin/products/${p.id}`} className="font-medium hover:text-brand-orange-strong">
                        {(locale === "en" ? p.enTitle : null) ?? p.faTitle}
                      </Link>
                      {p.brandName ? <span className="block text-xs text-muted-foreground">{p.brandName}</span> : null}
                    </td>
                    <td className="py-2 pe-3 font-mono text-xs" dir="ltr">
                      {p.sku}
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">{p.price && p.price > 0n ? money(p.price, locale, data.unit) : <Badge>{t("noPrice")}</Badge>}</td>
                    <td className="py-2 pe-3">{p.categoryName}</td>
                    <td className="py-2">
                      <Badge tone={STATUS_TONE[p.status]}>{t(`status.${p.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.page > 1 || list.hasMore ? (
          <nav className="mt-4 flex justify-between text-sm" aria-label={t("pages")}>
            {list.page > 1 ? <Link href={pageHref(list.page - 1)}>{t("previous")}</Link> : <span />}
            {list.hasMore ? <Link href={pageHref(list.page + 1)}>{t("next")}</Link> : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
