import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { redirect } from "@/lib/i18n/navigation";
import { customerLogoutAction } from "@/modules/identity/api/customer-actions";
import { readSessionToken } from "@/modules/identity/api/cookies";
import { getCustomer } from "@/modules/identity/service/customer-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  return { title: t("title"), robots: { index: false } };
}

/** Minimal account page; orders, addresses and vehicles arrive with the storefront (Phase 6b). */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await getCustomer(await readSessionToken("customer"));
  if (!customer) redirect({ href: "/login", locale });
  const t = await getTranslations("Account");
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-bold" data-testid="account-heading">
          {t("title")}
        </h1>
        <p>
          {t("signedInAs")}{" "}
          <span dir="ltr" className="font-semibold">
            {customer!.user.phoneNumber}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{t("comingSoon")}</p>
        <form action={customerLogoutAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="outline">
            {t("logout")}
          </Button>
        </form>
      </div>
    </div>
  );
}
