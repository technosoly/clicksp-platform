import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

const TABS = [
  ["", "overview"],
  ["/accounts", "accounts"],
  ["/periods", "periods"],
  ["/journal", "journal"],
  ["/money", "money"],
  ["/reports", "reports"],
] as const;

/** The accounting area's sub-navigation. */
export async function AccountingTabs({ current }: { current: (typeof TABS)[number][1] }) {
  const t = await getTranslations("AdminAccounting.tabs");
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5 text-sm" aria-label={t("label")}>
      {TABS.map(([path, key]) => (
        <Link key={key} href={`/admin/accounting${path}`} className={`rounded-md border px-2.5 py-1 ${current === key ? "bg-accent font-semibold" : ""}`} aria-current={current === key ? "page" : undefined}>
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
