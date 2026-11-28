import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { CONTACT_LIMITS } from "@/modules/settings/domain/contact-info";
import { saveContactInfoAction } from "@/modules/settings/api/contact-actions";
import { contactInfoForAdmin } from "@/modules/settings/service/contact-info";
import { adminPage } from "@/modules/identity/api/admin-page";

const area = "w-full rounded-md border border-input bg-background p-2 text-base leading-7";

export default async function AdminContactInfoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: c } = await adminPage(locale, (actor) => contactInfoForAdmin(actor), "/admin/content/contact");
  const t = await getTranslations("AdminContact");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-contact-heading"
        actions={
          <span className="flex gap-3 text-sm">
            <Link href="/contact" className="underline" data-testid="admin-contact-view">
              {t("view")}
            </Link>
            <Link href="/admin/content" className="underline">
              {t("back")}
            </Link>
          </span>
        }
      />
      <ActionForm action={saveContactInfoAction} submitLabel={t("save")} testId="admin-contact-form" namespace="AdminContact">
        <Card title={t("detailsTitle")}>
          <div className="space-y-4">
            <Field label={t("fields.addressFa")} htmlFor="contact-address-fa">
              <textarea id="contact-address-fa" name="addressFa" dir="rtl" rows={3} maxLength={CONTACT_LIMITS.address} defaultValue={c.address.fa} className={area} />
            </Field>
            <Field label={t("fields.addressEn")} htmlFor="contact-address-en" hint={t("fields.enHint")}>
              <textarea id="contact-address-en" name="addressEn" dir="ltr" rows={3} maxLength={CONTACT_LIMITS.address} defaultValue={c.address.en} className={area} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Field key={i} label={t("fields.phone", { number: i + 1 })} htmlFor={`contact-phone-${i + 1}`}>
                  <Input id={`contact-phone-${i + 1}`} name={`phone${i + 1}`} type="tel" dir="ltr" inputMode="tel" maxLength={CONTACT_LIMITS.phone} defaultValue={c.phones[i] ?? ""} />
                </Field>
              ))}
            </div>
            <Field label={t("fields.email")} htmlFor="contact-email">
              <Input id="contact-email" name="email" type="email" dir="ltr" maxLength={CONTACT_LIMITS.email} defaultValue={c.email} />
            </Field>
            <Field label={t("fields.hoursFa")} htmlFor="contact-hours-fa" hint={t("fields.hoursHint")}>
              <textarea id="contact-hours-fa" name="hoursFa" dir="rtl" rows={3} maxLength={CONTACT_LIMITS.hours} defaultValue={c.hours.fa} className={area} />
            </Field>
            <Field label={t("fields.hoursEn")} htmlFor="contact-hours-en">
              <textarea id="contact-hours-en" name="hoursEn" dir="ltr" rows={3} maxLength={CONTACT_LIMITS.hours} defaultValue={c.hours.en} className={area} />
            </Field>
          </div>
        </Card>
        <Card title={t("mapsTitle")} description={t("mapsHelp")}>
          <div className="space-y-4">
            <Field label={t("fields.google")} htmlFor="contact-google" hint={t("fields.googleHint")}>
              <Input id="contact-google" name="google" type="url" dir="ltr" maxLength={CONTACT_LIMITS.url} defaultValue={c.maps.google} />
            </Field>
            <Field label={t("fields.neshan")} htmlFor="contact-neshan">
              <Input id="contact-neshan" name="neshan" type="url" dir="ltr" maxLength={CONTACT_LIMITS.url} defaultValue={c.maps.neshan} />
            </Field>
            <Field label={t("fields.balad")} htmlFor="contact-balad">
              <Input id="contact-balad" name="balad" type="url" dir="ltr" maxLength={CONTACT_LIMITS.url} defaultValue={c.maps.balad} />
            </Field>
            <Field label={t("fields.googleEmbed")} htmlFor="contact-google-embed" hint={t("fields.googleEmbedHint")}>
              <textarea id="contact-google-embed" name="googleEmbed" dir="ltr" rows={3} maxLength={CONTACT_LIMITS.url + 200} defaultValue={c.maps.googleEmbed} className={`${area} font-mono text-xs`} />
            </Field>
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
