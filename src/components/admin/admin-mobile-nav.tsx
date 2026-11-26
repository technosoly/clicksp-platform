"use client";

import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { usePathname } from "@/lib/i18n/navigation";
import type { AdminNavGroup } from "./admin-nav";
import { AdminNavLinks } from "./admin-nav-links";

/** Phone menu: a native disclosure (works before hydration), closed again after each navigation. */
export function AdminMobileNav({ groups }: { groups: AdminNavGroup[] }) {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  return (
    <details key={pathname} className="group rounded-xl border bg-card md:hidden" data-testid="admin-mobile-nav">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        {t("menu")}
        <span aria-hidden className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <nav aria-label={t("navLabel")} className="border-t p-2">
        <AdminNavLinks groups={groups} />
        <div className="mt-3 border-t px-3 pt-3">
          <LanguageSwitcher />
        </div>
      </nav>
    </details>
  );
}
