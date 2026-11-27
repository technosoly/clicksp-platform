import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { shopLocale } from "@/components/store/shop-locale";

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Layouts render independently of pages, so each one sets the locale. The
  // header reads the cart cookie, so store pages render per request.
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={shopLocale(locale)} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
