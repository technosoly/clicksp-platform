import { getTranslations } from "next-intl/server";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";

/** Previous / next links that keep the other search params. */
export async function Pagination({ path, params, page, pages, locale }: { path: string; params: Record<string, string>; page: number; pages: number; locale: string }) {
  if (pages <= 1) return null;
  const t = await getTranslations("Shop");
  const href = (p: number) => {
    const q = new URLSearchParams({ ...params, ...(p > 1 ? { page: String(p) } : {}) });
    if (p <= 1) q.delete("page");
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <nav className="flex items-center justify-center gap-3 text-sm" aria-label={t("pagination")}>
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className="rounded-md border px-3 py-2 hover:bg-accent" data-testid="page-prev">
          {t("previous")}
        </Link>
      ) : null}
      <span className="text-muted-foreground">{t("pageOf", { page: formatCount(page, locale), pages: formatCount(pages, locale) })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className="rounded-md border px-3 py-2 hover:bg-accent" data-testid="page-next">
          {t("next")}
        </Link>
      ) : null}
    </nav>
  );
}
