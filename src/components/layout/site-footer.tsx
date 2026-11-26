import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const meta = await getTranslations("Metadata");
  const common = await getTranslations("Common");
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>{common("brandTagline")}</p>
        <p>{t("rights", { name: meta("siteName") })}</p>
      </div>
    </footer>
  );
}
