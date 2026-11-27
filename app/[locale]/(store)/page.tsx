import { setRequestLocale } from "next-intl/server";
import { BuilderSections } from "@/components/builder/builder-sections";
import { shopLocale } from "@/components/store/shop-locale";
import { shopHomeDocument } from "@/modules/pagebuilder/service/builder";

// Catalog data and the published layout change from the admin; render per request.
export const dynamic = "force-dynamic";

/** The home page: the layout published in the page builder (or the default one). */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  return <BuilderSections document={await shopHomeDocument()} locale={shopLocale(raw)} />;
}
