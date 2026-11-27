import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { shopLocale } from "@/components/store/shop-locale";
import type { Block } from "@/modules/content/domain/info-page";
import { shopInfoPage } from "@/modules/content/service/info-pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, key } = await params;
  const page = await shopInfoPage(shopLocale(locale), key);
  if (!page) return {};
  const languages: Record<string, string> = { fa: `/fa/pages/${page.key}`, "x-default": `/fa/pages/${page.key}` };
  if (page.hasEnglish) languages.en = `/en/pages/${page.key}`;
  return {
    title: page.title,
    alternates: { canonical: `/${shopLocale(locale)}/pages/${page.key}`, languages },
    // The English URL of a page written only in Persian repeats the Persian text: not indexed.
    ...(page.isFallback ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Blocks are plain text rendered as elements: nothing in a page can run or inject markup. */
function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return blocks.map((b, i) =>
    b.type === "heading" ? (
      <h2 key={i} className="pt-2 text-lg font-bold">
        {b.text}
      </h2>
    ) : b.type === "paragraph" ? (
      <p key={i} className="whitespace-pre-line">
        {b.text}
      </p>
    ) : (
      <ul key={i} className="list-disc space-y-1 ps-6">
        {b.items.map((item, j) => (
          <li key={j}>{item}</li>
        ))}
      </ul>
    ),
  );
}

export default async function InfoPage({ params }: Props) {
  const { locale: raw, key } = await params;
  setRequestLocale(raw);
  const page = await shopInfoPage(shopLocale(raw), key);
  if (!page) notFound();
  const t = await getTranslations("Shop");
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-8 leading-8" data-testid="info-page">
      {page.isFallback ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="info-page-fallback">
          {t("persianOnly")}
        </p>
      ) : null}
      <div lang={page.lang} dir={page.lang === "fa" ? "rtl" : "ltr"} className="space-y-4">
        <h1 className="text-2xl font-bold" data-testid="info-page-title">
          {page.title}
        </h1>
        <Blocks blocks={page.blocks} />
      </div>
    </article>
  );
}
