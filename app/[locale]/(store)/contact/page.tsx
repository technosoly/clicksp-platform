import type { Metadata } from "next";
import { siteWording } from "@/components/layout/site-wording";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { Icon, type IconName } from "@/components/store/info/icons";
import { MapEmbed } from "@/components/store/info/map-embed";
import { StaticMap } from "@/components/store/info/static-map";
import { RichBlocks } from "@/components/store/rich-blocks";
import { shopLocale } from "@/components/store/shop-locale";
import { toFaDigits } from "@/lib/persian-text";
import { MAP_PROVIDERS, hasContactDetails, telHref } from "@/modules/settings/domain/contact-info";
import { shopInfoPage } from "@/modules/content/service/info-pages";
import { shopContactInfo } from "@/modules/settings/service/contact-info";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = shopLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Contact" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: `/${locale}/contact`, languages: { fa: "/fa/contact", en: "/en/contact", "x-default": "/fa/contact" } },
    openGraph: { title: t("title"), description: t("description"), url: `/${locale}/contact` },
  };
}

function InfoCard({ icon, title, children, testId }: { icon: IconName; title: string; children: ReactNode; testId: string }) {
  return (
    <section className="flex gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5" data-testid={testId}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange-strong">
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        <div className="leading-7">{children}</div>
      </div>
    </section>
  );
}

export default async function ContactPage({ params }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const [c, extra, t, meta] = await Promise.all([shopContactInfo(), shopInfoPage(locale, "contact"), getTranslations("Contact"), siteWording(locale)]);
  const digits = (s: string) => (locale === "fa" ? toFaDigits(s) : s);
  // The English address and hours fall back to the Persian text, marked with lang.
  const address = locale === "en" && c.address.en ? { text: c.address.en, lang: "en" } : { text: c.address.fa, lang: "fa" };
  const hours = locale === "en" && c.hours.en ? { text: c.hours.en, lang: "en" } : { text: c.hours.fa, lang: "fa" };
  const mapLinks = MAP_PROVIDERS.filter((p) => c.maps[p]);
  const jsonLd = hasContactDetails(c)
    ? {
        "@context": "https://schema.org",
        "@type": "Store",
        name: meta.name,
        ...(address.text ? { address: address.text } : {}),
        ...(c.phones.length > 0 ? { telephone: c.phones[0] } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(hours.text ? { openingHours: hours.text } : {}),
        ...(c.maps.google ? { hasMap: c.maps.google } : {}),
      }
    : null;

  return (
    <div className="pb-10">
      <div className="bg-brand-charcoal text-brand-offwhite">
        <div className="mx-auto max-w-6xl space-y-3 px-4 pb-10 pt-5 sm:pb-14">
          <div className="[&_a]:text-brand-silver [&_nav]:text-brand-silver/80 [&_span[aria-current]]:text-brand-offwhite">
            <Breadcrumbs items={[{ name: t("title") }]} />
          </div>
          <p className="text-sm font-semibold text-brand-orange">{t("eyebrow")}</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl" data-testid="contact-heading">
            {t("title")}
          </h1>
          <p className="max-w-2xl leading-8 text-brand-silver">{t("intro")}</p>
        </div>
      </div>

      <div className="mx-auto -mt-6 grid max-w-6xl gap-4 px-4 sm:-mt-8 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          {!hasContactDetails(c) ? (
            <p className="rounded-xl border border-dashed border-brand-orange/50 bg-card p-4 text-sm leading-7 text-muted-foreground" data-testid="contact-not-set">
              {t("notSet")}
            </p>
          ) : null}
          {address.text ? (
            <InfoCard icon="pin" title={t("address")} testId="contact-address">
              <p lang={address.lang} className="whitespace-pre-line">
                {address.text}
              </p>
            </InfoCard>
          ) : null}
          {c.phones.length > 0 ? (
            <InfoCard icon="phone" title={t("phone")} testId="contact-phones">
              <ul className="space-y-1">
                {c.phones.map((p) => (
                  <li key={p}>
                    <a href={telHref(p)} dir="ltr" className="text-lg font-bold tracking-wide hover:text-brand-orange-strong" data-testid="contact-phone">
                      {digits(p)}
                    </a>
                  </li>
                ))}
              </ul>
            </InfoCard>
          ) : null}
          {hours.text ? (
            <InfoCard icon="clock" title={t("hours")} testId="contact-hours">
              <p lang={hours.lang} className="whitespace-pre-line">
                {digits(hours.text)}
              </p>
            </InfoCard>
          ) : null}
          {c.email ? (
            <InfoCard icon="mail" title={t("email")} testId="contact-email">
              <a href={`mailto:${c.email}`} dir="ltr" className="break-all font-medium hover:text-brand-orange-strong">
                {c.email}
              </a>
            </InfoCard>
          ) : null}
        </div>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm lg:col-span-3" aria-labelledby="contact-map-title" data-testid="contact-map">
          <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
            <StaticMap />
            {c.maps.googleEmbed ? <MapEmbed src={c.maps.googleEmbed} title={t("mapTitle")} /> : null}
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <h2 id="contact-map-title" className="flex items-center gap-2 font-bold">
              <Icon name="map" className="size-5 text-brand-orange-strong" />
              {t("mapTitle")}
            </h2>
            {mapLinks.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">{t("mapHelp")}</p>
                <ul className="flex flex-wrap gap-2">
                  {mapLinks.map((p) => (
                    <li key={p}>
                      <a
                        href={c.maps[p]}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold hover:border-brand-orange hover:text-brand-orange-strong"
                        data-testid={`contact-map-${p}`}
                      >
                        {t(`maps.${p}`)}
                        <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("mapSoon")}</p>
            )}
          </div>
        </section>
      </div>

      {extra && !extra.isFallback ? (
        <article lang={extra.lang} className="mx-auto mt-8 max-w-3xl space-y-4 px-4 leading-8" data-testid="contact-extra">
          <RichBlocks blocks={extra.blocks} />
        </article>
      ) : null}

      {jsonLd ? (
        // JSON-LD, with "<" escaped so text from the admin cannot close the script element.
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      ) : null}
    </div>
  );
}
