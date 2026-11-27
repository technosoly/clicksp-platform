import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogImage } from "@/components/media/catalog-image";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { RichBlocks } from "@/components/store/rich-blocks";
import { alternatesFor } from "@/components/store/seo";
import { shopLocale } from "@/components/store/shop-locale";
import { formatDate } from "@/lib/i18n/dates";
import { redirect } from "@/lib/i18n/navigation";
import { shopArticle } from "@/modules/content/service/articles";
import { mediaUrl, pickRendition } from "@/modules/media/domain/image-rules";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

const decoded = (slug: string) => {
  try {
    return decodeURIComponent(slug);
  } catch {
    return "";
  }
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = shopLocale(raw);
  const article = await shopArticle(locale, decoded(slug));
  if (!article) return {};
  const cover = pickRendition(article.cover, 1200);
  return {
    title: article.title,
    description: article.excerpt ?? undefined,
    alternates: alternatesFor(locale, "blog", article.slugs),
    openGraph: { type: "article", title: article.title, description: article.excerpt ?? undefined, publishedTime: article.publishedAt.toISOString(), images: cover ? [mediaUrl(cover.key)] : undefined },
    // The English address of an article written only in Persian repeats the Persian text: not indexed.
    ...(article.isFallback ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ArticlePage({ params }: Props) {
  const { locale: raw, slug } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const wanted = decoded(slug);
  const article = await shopArticle(locale, wanted);
  if (!article) notFound();
  // Found by the other language's address: send the visitor to this language's one.
  if (article.canonicalSlug !== wanted) redirect({ href: `/blog/${article.canonicalSlug}`, locale });
  const t = await getTranslations("Blog");
  return (
    <article className="mx-auto max-w-3xl space-y-5 px-4 py-6 leading-8" data-testid="article-page">
      <Breadcrumbs items={[{ name: t("title"), href: "/blog" }, { name: article.title }]} />
      {article.isFallback ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="article-fallback">
          {t("persianOnly")}
        </p>
      ) : null}
      <div lang={article.lang} dir={article.lang === "fa" ? "rtl" : "ltr"} className="space-y-4">
        <h1 className="text-2xl font-bold leading-10 sm:text-3xl" data-testid="article-title">
          {article.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt, locale, { dateStyle: "long" })}</time>
        </p>
        {article.cover.length ? (
          <CatalogImage renditions={article.cover} alt="" sizes="(min-width: 768px) 720px, 100vw" width={1200} priority className="aspect-[16/9] w-full rounded-lg object-cover" />
        ) : null}
        {article.excerpt ? <p className="text-lg text-muted-foreground">{article.excerpt}</p> : null}
        <RichBlocks blocks={article.blocks} />
      </div>
    </article>
  );
}
