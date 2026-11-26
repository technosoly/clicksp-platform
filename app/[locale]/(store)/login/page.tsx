import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PhoneLoginForm } from "@/components/auth/phone-login-form";
import { redirect } from "@/lib/i18n/navigation";
import { readSessionToken } from "@/modules/identity/api/cookies";
import { getCustomer, isPhoneLoginAvailable } from "@/modules/identity/service/customer-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "CustomerAuth" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CustomerLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getCustomer(await readSessionToken("customer"))) redirect({ href: "/account", locale });
  const t = await getTranslations("CustomerAuth");
  const available = isPhoneLoginAvailable();
  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <div className="space-y-5 rounded-xl border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-bold" data-testid="customer-login-heading">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {available ? (
          <PhoneLoginForm />
        ) : (
          <p role="status" data-testid="phone-login-unavailable" className="rounded-md bg-muted px-3 py-2 text-sm">
            {t("unavailable")}
          </p>
        )}
      </div>
    </div>
  );
}
