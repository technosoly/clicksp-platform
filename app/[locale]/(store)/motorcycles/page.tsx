import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { shopMotorcycleBrands } from "@/modules/vehicles/service/shop";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("Shop");
  return { title: t("byMotorcycle"), alternates: { canonical: `/${locale}/motorcycles`, languages: { fa: "/fa/motorcycles", en: "/en/motorcycles", "x-default": "/fa/motorcycles" } } };
}

export default async function MotorcyclesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const [t, brands] = await Promise.all([getTranslations("Shop"), shopMotorcycleBrands(locale)]);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[{ name: t("byMotorcycle") }]} />
      <div>
        <h1 className="text-2xl font-extrabold" data-testid="motorcycles-heading">
          {t("byMotorcycle")}
        </h1>
        <p className="text-muted-foreground">{t("byMotorcycleIntro")}</p>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground" data-testid="motorcycles-empty">
          {t("motorcyclesEmpty")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <section key={b.id} className="rounded-lg border bg-card p-4" data-testid="motorcycle-brand">
              <h2 className="mb-2 font-bold">{b.name}</h2>
              <ul className="flex flex-wrap gap-2">
                {b.models.map((m) => (
                  <li key={m.id}>
                    <Link href={`/motorcycles/${m.slug}`} className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm hover:border-brand-orange" data-testid="motorcycle-model-link">
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
