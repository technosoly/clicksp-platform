"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import type { AdminNavGroup } from "./admin-nav";

/** Sidebar links with the current page marked (client only for the pathname). */
export function AdminNavLinks({ groups }: { groups: AdminNavGroup[] }) {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.labelKey}>
          <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">{t(`navGroups.${group.labelKey}`)}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    data-testid={`admin-nav-${item.labelKey}`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                      active ? "bg-secondary font-semibold text-secondary-foreground hover:bg-secondary" : "text-foreground",
                    )}
                  >
                    <span>{t(`nav.${item.labelKey}`)}</span>
                    {item.ready ? null : <span className="text-[10px] font-normal opacity-70">{t("soon")}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
