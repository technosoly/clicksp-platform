import "@fontsource-variable/vazirmatn/wght.css";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { localeDirection, type Locale } from "@/lib/i18n/config";
import { routing } from "@/lib/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#272a2d",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return {
    metadataBase: new URL(appUrl),
    title: { default: t("title"), template: `%s | ${t("siteName")}` },
    description: t("description"),
    applicationName: t("siteName"),
    alternates: {
      canonical: `/${locale}`,
      languages: { fa: "/fa", en: "/en", "x-default": "/fa" },
    },
    openGraph: {
      siteName: t("siteName"),
      locale: locale === "fa" ? "fa_IR" : "en_US",
      type: "website",
    },
    icons: {
      icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }],
      apple: "/brand/apple-touch-icon.png",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Common" });

  return (
    <html lang={locale === "fa" ? "fa-IR" : "en"} dir={localeDirection[locale as Locale]}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
