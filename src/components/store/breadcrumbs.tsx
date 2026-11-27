import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

export async function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  const t = await getTranslations("Shop");
  return (
    <nav aria-label={t("breadcrumbs")} className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        <li>
          <Link href="/" className="hover:underline">
            {t("home")}
          </Link>
        </li>
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-x-1.5">
            <span aria-hidden>/</span>
            {item.href ? (
              <Link href={item.href} className="hover:underline">
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
