import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogImage } from "@/components/media/catalog-image";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Pagination } from "@/components/store/pagination";
import { shopLocale } from "@/components/store/shop-locale";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { shopArticles } from "@/modules/content/service/articles";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const page = Number((await searchParams).page ?? "1") || 1;
  const t = await getTranslations({ locale, namespace: "Blog" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: { canonical: `/${shopLocale(locale)}/blog${page > 1 ? `?page=${page}` : ""}`, languages: { fa: "/fa/blog", en: "/en/blog", "x-default": "/fa/blog" } },
  };
}

export default async function BlogPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const data = await shopArticles(locale, Number((await searchParams).page ?? "1") || 1);
  const t = await getTranslations("Blog");
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[{ name: t("title") }]} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold" data-testid="blog-heading">
          {t("title")}
        </h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>
      {data.items.length === 0 ? (
        <p className="text-muted-foreground" data-testid="blog-empty">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="blog-list">
          {data.items.map((a, i) => (
            <li key={a.id} className="overflow-hidden rounded-lg border bg-card" data-testid="blog-card">
              <Link href={`/blog/${a.slug}`} className="block h-full hover:bg-accent/40">
                <CatalogImage renditions={a.cover} alt="" sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw" width={640} priority={i === 0} className="aspect-[16/9] w-full object-cover" />
                <div className="space-y-2 p-4" lang={a.lang} dir={a.lang === "fa" ? "rtl" : "ltr"}>
                  <h2 className="text-lg font-bold leading-7">{a.title}</h2>
                  {a.excerpt ? <p className="line-clamp-3 text-sm text-muted-foreground">{a.excerpt}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={a.publishedAt.toISOString()}>{formatDate(a.publishedAt, locale, { dateStyle: "medium" })}</time>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination path="/blog" params={{}} page={data.page} pages={data.pages} locale={locale} />
    </div>
  );
}
