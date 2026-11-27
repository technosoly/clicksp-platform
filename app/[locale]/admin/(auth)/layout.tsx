import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export default async function AdminAuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Admin");
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted px-4 py-10">
      <div className="flex items-center gap-3">
        <Image src="/brand/logo-badge-96.webp" alt="" width={48} height={48} className="size-12 rounded-full" />
        <span className="text-lg font-bold">{t("title")}</span>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
      <LanguageSwitcher />
    </main>
  );
}
