import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { SearchForm } from "@/components/store/search-form";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { cartOwner } from "@/modules/sales/api/cart-owner";
import { cartCount } from "@/modules/sales/service/cart";
import { LanguageSwitcher } from "./language-switcher";

export async function SiteHeader({ locale }: { locale: "fa" | "en" }) {
  const count = await cartCount(await cartOwner());
  const t = await getTranslations("Metadata");
  const nav = await getTranslations("Header");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="flex items-center gap-2" aria-label={t("siteName")}>
          <Image src="/brand/logo-badge.webp" alt="" width={40} height={40} className="size-10" />
          <span className="text-lg font-bold">{t("siteName")}</span>
        </Link>
        <SearchForm className="order-last w-full md:order-none md:w-auto md:flex-1" testId="header-search" />
        <nav className="ms-auto flex items-center gap-1" aria-label={nav("menu")}>
          <Link href="/motorcycles" className="rounded-md px-3 py-2 text-sm hover:bg-accent" data-testid="header-motorcycles">
            {nav("motorcycles")}
          </Link>
          {/* Static link: the account page itself sends signed-out visitors to sign in. */}
          <Link href="/account" className="rounded-md px-3 py-2 text-sm hover:bg-accent" data-testid="header-account">
            {nav("account")}
          </Link>
          <Link href="/cart" className="rounded-md px-3 py-2 text-sm hover:bg-accent" data-testid="header-cart">
            {nav("cart")}
            {count > 0 ? (
              <span className="ms-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground" data-testid="header-cart-count">
                {formatCount(count, locale)}
              </span>
            ) : null}
          </Link>
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  );
}
