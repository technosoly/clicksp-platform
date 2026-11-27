import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { CatalogImage } from "@/components/media/catalog-image";
import { HeroSlider, type HeroSlide } from "@/components/store/hero-slider";
import { ProductGrid } from "@/components/store/product-grid";
import { RichBlocks } from "@/components/store/rich-blocks";
import { SearchForm } from "@/components/store/search-form";
import { CategoryTile } from "@/components/store/tile";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import { shopHome } from "@/modules/catalog/service/storefront";
import { parseHref } from "@/modules/content/domain/links";
import { shopArticles } from "@/modules/content/service/articles";
import { shopBanners } from "@/modules/content/service/banners";
import { mediaUrl, pickRendition, srcSet } from "@/modules/media/domain/image-rules";
import type { BuilderDocument, BuilderSection, Visibility } from "@/modules/pagebuilder/domain/registry";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import { shopMotorcycleBrands } from "@/modules/vehicles/service/shop";

type ShopLocale = "fa" | "en";

/**
 * Renders a page builder document as Server Components. Every piece of text
 * from the document is rendered as a React text node; links are re-checked
 * here and go through the store's Link or an https anchor; colours come from
 * a fixed tone list. Nothing from a document becomes HTML, a style, a class
 * name or a script.
 */

type Localized = { fa?: string; en?: string };
/** The visitor's language, or the Persian text when English is missing. */
function pick(l: Localized | undefined, locale: ShopLocale): { text: string; lang: "fa" | "en" } | null {
  if (locale === "en" && l?.en) return { text: l.en, lang: "en" };
  return l?.fa ? { text: l.fa, lang: "fa" } : null;
}

// Literal class names so Tailwind generates them: [mobile][tablet][desktop].
const SHOW: Record<string, string> = {
  "111": "",
  "110": "lg:hidden",
  "101": "sm:max-lg:hidden",
  "100": "sm:hidden",
  "011": "max-sm:hidden",
  "010": "max-sm:hidden lg:hidden",
  "001": "max-lg:hidden",
};
const showClass = (v: Visibility) => SHOW[(["mobile", "tablet", "desktop"] as const).map((b) => (v.breakpoints.includes(b) ? "1" : "0")).join("")] ?? "";

const TONE = {
  charcoal: "bg-brand-charcoal text-brand-offwhite",
  orange: "bg-brand-orange-strong text-white",
  light: "bg-accent text-accent-foreground",
} as const;

/** Loads what the document's sections show, one query per kind of data. */
async function loadData(sections: readonly BuilderSection[], locale: ShopLocale) {
  const max = (type: BuilderSection["type"]) => Math.max(0, ...sections.flatMap((s) => (s.type === type ? [(s.props as { limit: number }).limit] : [])));
  const has = (type: BuilderSection["type"]) => sections.some((s) => s.type === type);
  const categories = max("categories");
  const latest = max("latestProducts");
  const [home, brands, unit, banners, articles] = await Promise.all([
    categories || latest ? shopHome(locale, { categories, latest }) : { categories: [], latest: [] },
    has("motorcycles") ? shopMotorcycleBrands(locale) : [],
    latest ? getDisplayUnit() : null,
    has("bannerSlider") ? shopBanners(locale) : [],
    has("latestArticles") ? shopArticles(locale, 1) : { items: [] },
  ]);
  const slides: HeroSlide[] = banners.flatMap((b) => {
    const main = pickRendition(b.desktop, 1280);
    if (!main) return [];
    return [{ ...b, desktop: { src: mediaUrl(main.key), srcSet: srcSet(b.desktop), width: main.width, height: main.height }, mobile: b.mobile.length ? { srcSet: srcSet(b.mobile) } : null }];
  });
  const models = brands.flatMap((b) => b.models.map((m) => ({ id: m.id, slug: m.slug, name: `${b.name} ${m.name}` })));
  return { home, models, unit, slides, articles: articles.items };
}

type Data = Awaited<ReturnType<typeof loadData>>;

function SafeLink({ href, className, children, testId }: { href: string; className?: string; children: React.ReactNode; testId?: string }) {
  const parsed = parseHref(href);
  if (!parsed) return null;
  if (parsed.kind === "external") {
    return (
      <a href={parsed.url} rel="noopener noreferrer" target="_blank" className={className} data-testid={testId}>
        {children}
      </a>
    );
  }
  return (
    <Link href={parsed.path} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}

function Heading({ id, value, fallback, locale }: { id: string; value: Localized; fallback: string; locale: ShopLocale }) {
  const text = pick(value, locale);
  return (
    <h2 id={id} className="text-xl font-bold" lang={text?.lang}>
      {text?.text ?? fallback}
    </h2>
  );
}

export async function BuilderSections({ document, locale }: { document: BuilderDocument; locale: ShopLocale }) {
  const sections = document.sections.filter((s) => s.visibility.locales.includes(locale));
  const [data, t, ts, tb] = await Promise.all([loadData(sections, locale), getTranslations("Home"), getTranslations("Shop"), getTranslations("Blog")]);
  const firstHero = sections.find((s) => s.type === "hero")?.id;
  return sections.map((s) => (
    <div key={s.id} className={showClass(s.visibility)} data-section={s.type}>
      {render(s, data, locale, { t, ts, tb, h1: s.id === firstHero })}
    </div>
  ));
}

type Tr = Awaited<ReturnType<typeof getTranslations>>;

function render(s: BuilderSection, data: Data, locale: ShopLocale, ctx: { t: Tr; ts: Tr; tb: Tr; h1: boolean }) {
  const { t, ts, tb } = ctx;
  const hid = `${s.id}-heading`;
  const wrap = "mx-auto max-w-6xl space-y-3 px-4 py-5";
  switch (s.type) {
    case "bannerSlider":
      return <HeroSlider slides={data.slides} />;

    case "hero": {
      const title = pick(s.props.title, locale);
      const subtitle = pick(s.props.subtitle, locale);
      const H = ctx.h1 ? "h1" : "h2";
      return (
        <section className={TONE[s.props.tone]}>
          <div className={cn("mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 text-center sm:py-14 md:flex-row md:text-start", !s.props.showLogo && "md:flex-col md:items-start")}>
            {s.props.showLogo ? <Image src="/brand/logo-badge.webp" alt="" width={176} height={176} priority className="size-28 shrink-0 sm:size-44" /> : null}
            <div className="w-full space-y-4">
              <H className="text-3xl font-extrabold tracking-tight sm:text-4xl" data-testid={ctx.h1 ? "home-heading" : undefined} lang={title?.lang}>
                {title?.text ?? t("heading")}
              </H>
              <p className="text-lg opacity-90" lang={subtitle?.lang}>
                {subtitle?.text ?? t("subheading")}
              </p>
              {s.props.showSearch ? <SearchForm className="max-w-xl" testId={ctx.h1 ? "home-search" : undefined} /> : null}
            </div>
          </div>
        </section>
      );
    }

    case "motorcycles": {
      const models = data.models.slice(0, s.props.limit);
      return (
        <section aria-labelledby={hid} className={wrap}>
          <div className="flex items-baseline justify-between gap-2">
            <Heading id={hid} value={s.props.heading} fallback={ts("byMotorcycle")} locale={locale} />
            <Link href="/motorcycles" className="text-sm text-brand-orange-strong underline">
              {ts("allMotorcycles")}
            </Link>
          </div>
          {models.length === 0 ? (
            <p className="text-muted-foreground" data-testid="home-bikes-empty">
              {ts("motorcyclesEmpty")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" data-testid="home-bikes">
              {models.map((m) => (
                <li key={m.id}>
                  <Link href={`/motorcycles/${m.slug}`} className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm hover:border-brand-orange">
                    {m.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    case "categories": {
      const categories = data.home.categories.slice(0, s.props.limit);
      return (
        <section aria-labelledby={hid} className={wrap}>
          <Heading id={hid} value={s.props.heading} fallback={ts("categories")} locale={locale} />
          {categories.length === 0 ? (
            <p className="text-muted-foreground" data-testid="home-categories-empty">
              {ts("categoriesEmpty")}
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {categories.map((c) => (
                <CategoryTile key={c.id} name={c.name} href={`/c/${c.slug}`} renditions={c.renditions} />
              ))}
            </ul>
          )}
        </section>
      );
    }

    case "latestProducts":
      return (
        <section aria-labelledby={hid} className={wrap}>
          <Heading id={hid} value={s.props.heading} fallback={ts("latest")} locale={locale} />
          <ProductGrid products={data.home.latest.slice(0, s.props.limit)} locale={locale} unit={data.unit!} empty={ts("productsEmpty")} />
        </section>
      );

    case "latestArticles": {
      const articles = data.articles.slice(0, s.props.limit);
      if (articles.length === 0) return null;
      return (
        <section aria-labelledby={hid} className={wrap}>
          <div className="flex items-baseline justify-between gap-2">
            <Heading id={hid} value={s.props.heading} fallback={tb("title")} locale={locale} />
            <Link href="/blog" className="text-sm text-brand-orange-strong underline">
              {tb("all")}
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-articles">
            {articles.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-lg border bg-card">
                <Link href={`/blog/${a.slug}`} className="block h-full hover:bg-accent/40">
                  <CatalogImage renditions={a.cover} alt="" sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw" width={640} className="aspect-[16/9] w-full object-cover" />
                  <div className="space-y-1 p-4" lang={a.lang} dir={a.lang === "fa" ? "rtl" : "ltr"}>
                    <h3 className="font-bold leading-7">{a.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={a.publishedAt.toISOString()}>{formatDate(a.publishedAt, locale, { dateStyle: "medium" })}</time>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case "richText": {
      const en = locale === "en" && s.props.content.en;
      const blocks = en ? s.props.content.en! : s.props.content.fa;
      const lang = en ? "en" : "fa";
      return (
        <section className={wrap}>
          <div className="max-w-3xl space-y-3 leading-8" lang={lang} dir={lang === "fa" ? "rtl" : "ltr"} data-testid="builder-rich-text">
            <RichBlocks blocks={blocks} />
          </div>
        </section>
      );
    }

    case "callout": {
      const title = pick(s.props.title, locale)!;
      const text = pick(s.props.text, locale);
      const cta = pick(s.props.cta, locale);
      return (
        <section className="mx-auto max-w-6xl px-4 py-5">
          <div className={cn("flex flex-col gap-4 rounded-xl p-6 sm:flex-row sm:items-center", TONE[s.props.tone])} data-testid="builder-callout">
            <div className="flex-1 space-y-2">
              <h2 className="text-xl font-bold" lang={title.lang}>
                {title.text}
              </h2>
              {text ? (
                <p className="opacity-90" lang={text.lang}>
                  {text.text}
                </p>
              ) : null}
            </div>
            {cta && s.props.href ? (
              <SafeLink href={s.props.href} className="inline-flex min-h-11 items-center justify-center rounded-md bg-background px-5 font-semibold text-foreground hover:opacity-90">
                <span lang={cta.lang}>{cta.text}</span>
              </SafeLink>
            ) : null}
          </div>
        </section>
      );
    }
  }
}
