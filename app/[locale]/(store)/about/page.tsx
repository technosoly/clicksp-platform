import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Icon, type IconName } from "@/components/store/info/icons";
import { RichBlocks } from "@/components/store/rich-blocks";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { shopInfoPage } from "@/modules/content/service/info-pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

const VALUES: { key: string; icon: IconName }[] = [
  { key: "genuine", icon: "shield" },
  { key: "fitment", icon: "gear" },
  { key: "shipping", icon: "truck" },
  { key: "support", icon: "headset" },
];
const STORY = ["p1", "p2", "p3"] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = shopLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "About" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: `/${locale}/about`, languages: { fa: "/fa/about", en: "/en/about", "x-default": "/fa/about" } },
    openGraph: { title: t("title"), description: t("description"), url: `/${locale}/about` },
  };
}

export default async function AboutPage({ params }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  // The text written in the admin (Website > Content > About us) replaces the built-in story.
  const [written, t] = await Promise.all([shopInfoPage(locale, "about"), getTranslations("About")]);
  const story = written && !written.isFallback ? written : null;
  return (
    <div className="pb-12">
      <div className="bg-brand-charcoal text-brand-offwhite">
        <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 pb-12 pt-5 md:grid-cols-[1fr_auto] md:pb-16">
          <div className="space-y-3">
            <div className="[&_a]:text-brand-silver [&_nav]:text-brand-silver/80 [&_span[aria-current]]:text-brand-offwhite">
              <Breadcrumbs items={[{ name: t("title") }]} />
            </div>
            <p className="text-sm font-semibold text-brand-orange">{t("eyebrow")}</p>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl" data-testid="about-heading">
              {t("headline")}
            </h1>
            <p className="max-w-2xl leading-8 text-brand-silver">{t("intro")}</p>
          </div>
          <Image src="/brand/logo-badge.webp" alt="" width={176} height={176} className="hidden size-44 rounded-full ring-4 ring-brand-orange/40 md:block" priority />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <section className="-mt-6 grid gap-3 sm:-mt-8 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("valuesLabel")} data-testid="about-values">
          {VALUES.map((v) => (
            <div key={v.key} className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
              <span className="flex size-11 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange-strong">
                <Icon name={v.icon} className="size-6" />
              </span>
              <h2 className="font-bold">{t(`values.${v.key}.title`)}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{t(`values.${v.key}.text`)}</p>
            </div>
          ))}
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          <article className="space-y-4 leading-8 lg:col-span-2" lang={story?.lang} data-testid="about-story">
            {story ? (
              <RichBlocks blocks={story.blocks} />
            ) : (
              <>
                <h2 className="text-xl font-bold">{t("storyTitle")}</h2>
                {STORY.map((k) => (
                  <p key={k}>{t(`story.${k}`)}</p>
                ))}
              </>
            )}
          </article>
          <aside className="space-y-4">
            <section className="rounded-xl border bg-card p-5 shadow-sm">
              <h2 className="mb-3 font-bold">{t("rangeTitle")}</h2>
              <ul className="space-y-2 text-sm leading-7">
                {(["engine", "brakes", "electrical", "consumables", "accessories"] as const).map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand-orange" aria-hidden="true" />
                    {t(`range.${k}`)}
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-3 rounded-xl bg-brand-orange-strong p-5 text-primary-foreground">
              <h2 className="text-lg font-bold">{t("ctaTitle")}</h2>
              <p className="text-sm leading-7 opacity-90">{t("ctaText")}</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/contact" className="inline-flex min-h-11 items-center rounded-lg bg-brand-charcoal px-4 text-sm font-semibold text-brand-offwhite hover:bg-black" data-testid="about-contact-link">
                  {t("ctaContact")}
                </Link>
                <Link href="/motorcycles" className="inline-flex min-h-11 items-center rounded-lg bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
                  {t("ctaShop")}
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
