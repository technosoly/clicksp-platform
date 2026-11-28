import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { AnnouncementBar } from "@/components/layout/announcement-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { siteWording } from "@/components/layout/site-wording";
import { shopLocale } from "@/components/store/shop-locale";

/** Name, home title and description as the owner set them in Site settings (built-in wording otherwise). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const site = await siteWording(shopLocale(locale));
  return {
    title: { default: site.seoTitle, template: `%s | ${site.name}` },
    description: site.seoDescription,
    applicationName: site.name,
    openGraph: { siteName: site.name, locale: locale === "en" ? "en_US" : "fa_IR", type: "website" },
  };
}

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Layouts render independently of pages, so each one sets the locale. The
  // header reads the cart cookie, so store pages render per request.
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = shopLocale(raw);
  const site = await siteWording(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      {site.announcement ? <AnnouncementBar announcement={site.announcement} /> : null}
      <SiteHeader locale={locale} name={site.name} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter site={site} />
    </div>
  );
}
