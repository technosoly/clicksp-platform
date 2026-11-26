import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";

/** Shown with HTTP 403 when an admin opens a page their permissions don't cover. */
export default async function AdminForbidden() {
  const t = await getTranslations("AdminForbidden");
  return (
    <section className="rounded-xl border bg-card p-8 text-center" data-testid="admin-forbidden">
      <p className="text-sm font-semibold text-brand-orange-strong">403</p>
      <h1 className="mt-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">{t("body")}</p>
      <Button asChild className="mt-5">
        <Link href="/admin">{t("back")}</Link>
      </Button>
    </section>
  );
}
