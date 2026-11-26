import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ADMIN_NAV, visibleNav } from "@/components/admin/admin-nav";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { adminLogoutAction } from "@/modules/identity/api/admin-actions";
import { requireAdmin } from "@/modules/identity/api/admin-guard";
import { getAdminProfile } from "@/modules/identity/service/admin-auth";
import { holds } from "@/modules/rbac/domain/authorize";

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
  const nav = visibleNav(ADMIN_NAV, (key) => holds(ctx.permissions, key));

  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="border-b bg-secondary text-secondary-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/admin" className="flex items-center gap-2 font-bold">
            <Image src="/brand/logo-badge.webp" alt="" width={32} height={32} className="size-8" />
            <span>{t("title")}</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline" data-testid="admin-user-name">
              {profile?.name || profile?.username}
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
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 md:flex-row">
        <nav aria-label={t("navLabel")} className="md:w-52 md:shrink-0">
          <ul className="flex gap-2 md:flex-col">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block rounded-md bg-card px-3 py-2 text-sm font-medium hover:bg-accent">
                  {t(`nav.${item.labelKey}`)}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden md:block">
            <LanguageSwitcher />
          </div>
        </nav>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
