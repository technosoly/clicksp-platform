import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <HomeContent />;
}

async function HomeContent() {
  const t = await getTranslations("Home");
  return (
    <section className="bg-brand-charcoal text-brand-cream">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-14 text-center sm:py-20 md:flex-row md:text-start">
        <Image
          src="/brand/logo-badge.webp"
          alt=""
          width={224}
          height={224}
          priority
          className="size-40 shrink-0 sm:size-56"
        />
        <div className="space-y-4">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl" data-testid="home-heading">
            {t("heading")}
          </h1>
          <p className="text-lg text-brand-cream/90">{t("subheading")}</p>
          <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-4 py-3" role="status">
            <p className="font-semibold text-brand-orange">{t("comingSoon")}</p>
            <p className="text-sm text-brand-cream/80">{t("comingSoonDetail")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
