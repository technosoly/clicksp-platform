import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BuilderSections } from "@/components/builder/builder-sections";
import { shopLocale } from "@/components/store/shop-locale";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { previewHomeDocument } from "@/modules/pagebuilder/service/builder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The home page draft as visitors would see it; only for admins who may edit the page builder. */
export default async function PreviewHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const { data: document } = await adminPage(raw, (actor) => previewHomeDocument(actor), "/preview/home");
  const t = await getTranslations("AdminBuilder");
  return (
    <>
      <p role="status" className="bg-brand-orange-strong px-4 py-2 text-center text-sm font-semibold text-white" data-testid="builder-preview-notice">
        {t("previewNotice")}{" "}
        <Link href="/admin/page-builder" className="underline">
          {t("backToEditor")}
        </Link>
      </p>
      <BuilderSections document={document} locale={shopLocale(raw)} />
    </>
  );
}
