import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { SearchForm } from "@/components/store/search-form";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { cartOwner } from "@/modules/sales/api/cart-owner";
import { shopMenu } from "@/modules/content/service/menus";
import { cartCount } from "@/modules/sales/service/cart";
import { LanguageSwitcher } from "./language-switcher";
import { MenuLink } from "./menu-link";

export async function SiteHeader({ locale, name }: { locale: "fa" | "en"; name: string }) {
  const [count, links] = await Promise.all([cartOwner().then(cartCount), shopMenu("header", locale)]);
  const nav = await getTranslations("Header");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="flex items-center gap-2" aria-label={name}>
          <Image src="/brand/logo-badge-96.webp" alt="" width={40} height={40} className="size-10 rounded-full" />
          <span className="text-lg font-bold" data-testid="header-site-name">{name}</span>
        </Link>
        <SearchForm className="order-last w-full md:order-none md:w-auto md:flex-1" testId="header-search" />
        <nav className="ms-auto flex items-center gap-1" aria-label={nav("menu")}>
          <Link href="/motorcycles" className="rounded-md px-3 py-2 text-sm hover:bg-accent" data-testid="header-motorcycles">
            {nav("motorcycles")}
          </Link>
          <Link href="/about" className="hidden rounded-md px-3 py-2 text-sm hover:bg-accent lg:inline-flex" data-testid="header-about">
            {nav("about")}
          </Link>
          <Link href="/contact" className="hidden rounded-md px-3 py-2 text-sm hover:bg-accent sm:inline-flex" data-testid="header-contact">
            {nav("contact")}
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
      {links.length > 0 ? (
        <nav className="border-t" aria-label={nav("more")}>
          {/* Scrolls sideways on phones instead of widening the page. */}
          <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none]">
            {links.map((l, i) => (
              <li key={i} className="shrink-0">
                <MenuLink link={l} className="inline-flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-accent" testId="header-menu-link" />
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
