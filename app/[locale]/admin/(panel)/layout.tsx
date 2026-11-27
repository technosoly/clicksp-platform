import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ADMIN_NAV, visibleNav } from "@/components/admin/admin-nav";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminNavLinks } from "@/components/admin/admin-nav-links";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { adminLogoutAction } from "@/modules/identity/api/admin-actions";
import { requireAdmin } from "@/modules/identity/api/admin-guard";
import { getAdminProfile } from "@/modules/identity/service/admin-auth";
import { holds } from "@/modules/rbac/domain/authorize";

const LEVEL_KEYS: Record<number, string> = { 1: "superAdmin", 2: "businessAdmin", 3: "storeStaff" };

export default async function AdminPanelLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { ctx } = await requireAdmin(locale);
  const profile = await getAdminProfile(ctx.session.userId);
  const t = await getTranslations("Admin");
  // Only the actor's own permission keys decide what is shown; pages authorize again.
  const nav = visibleNav(ADMIN_NAV, (key) => holds(ctx.permissions, key));

  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="sticky top-0 z-20 border-b border-black/20 bg-secondary text-secondary-foreground">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <Link href="/admin" className="flex items-center gap-2 font-bold">
            <Image src="/brand/logo-badge-96.webp" alt="" width={32} height={32} className="size-8 rounded-full" />
            <span>{t("title")}</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden flex-col items-end leading-tight sm:flex">
              <span data-testid="admin-user-name">{profile?.name || profile?.username}</span>
              <span className="text-xs text-brand-offwhite/70" data-testid="admin-header-role">
                {t(`levels.${LEVEL_KEYS[ctx.level] ?? "storeStaff"}`)}
              </span>
            </span>
            <form action={adminLogoutAction}>
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="outline" size="sm" className="text-foreground" data-testid="admin-logout">
                {t("logout")}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
        <AdminMobileNav groups={nav} />
        <aside className="hidden md:block md:w-56 md:shrink-0">
          <nav aria-label={t("navLabel")} className="sticky top-20 space-y-4" data-testid="admin-sidebar">
            <AdminNavLinks groups={nav} />
            <div className="px-3">
              <LanguageSwitcher />
            </div>
          </nav>
        </aside>
        <main id="main" className="min-w-0 flex-1 space-y-4">
          {children}
        </main>
      </div>
    </div>
  );
}
