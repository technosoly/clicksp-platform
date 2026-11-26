import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";

export async function SiteHeader() {
  const t = await getTranslations("Metadata");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2" aria-label={t("siteName")}>
          <Image src="/brand/logo-badge.webp" alt="" width={40} height={40} className="size-10" />
          <span className="text-lg font-bold">{t("siteName")}</span>
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
