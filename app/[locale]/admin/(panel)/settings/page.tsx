import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { saveSiteAppearanceAction } from "@/modules/settings/api/site-actions";
import { ANNOUNCEMENT_TONES, SITE_LIMITS, SOCIAL_NETWORKS } from "@/modules/settings/domain/site-appearance";
import { siteAppearanceForAdmin } from "@/modules/settings/service/site-appearance";

const area = "w-full rounded-md border border-input bg-background p-2 text-base leading-7";

type PairField = "name" | "tagline" | "seoTitle" | "seoDescription" | "footerNote";

/** Site appearance: name, wording, search-engine text, footer note, social links and the announcement bar. */
export default async function AdminSiteSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: s } = await adminPage(locale, (actor) => siteAppearanceForAdmin(actor), "/admin/settings");
  const [t, metaFa, metaEn, commonFa, commonEn] = await Promise.all([
    getTranslations("AdminSite"),
    getTranslations({ locale: "fa", namespace: "Metadata" }),
    getTranslations({ locale: "en", namespace: "Metadata" }),
    getTranslations({ locale: "fa", namespace: "Common" }),
    getTranslations({ locale: "en", namespace: "Common" }),
  ]);
  // The built-in wording shows as a placeholder, so an empty field says what the site shows now.
  const builtIn: Record<PairField, { fa: string; en: string }> = {
    name: { fa: metaFa("siteName"), en: metaEn("siteName") },
    tagline: { fa: commonFa("brandTagline"), en: commonEn("brandTagline") },
    seoTitle: { fa: metaFa("title"), en: metaEn("title") },
    seoDescription: { fa: metaFa("description"), en: metaEn("description") },
    footerNote: { fa: "", en: "" },
  };

  const pair = (field: PairField, multiline = false) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["fa", "en"] as const).map((lang) => {
        const id = `site-${field}-${lang}`;
        const props = {
          id,
          name: `${field}${lang === "fa" ? "Fa" : "En"}`,
          dir: lang === "fa" ? "rtl" : "ltr",
          maxLength: SITE_LIMITS[field],
          defaultValue: s[field][lang],
          placeholder: builtIn[field][lang] || undefined,
          "data-testid": id,
        } as const;
        return (
          <Field key={lang} label={`${t(`fields.${field}`)} (${t(lang === "fa" ? "persian" : "english")})`} htmlFor={id}>
            {multiline ? <textarea {...props} rows={3} className={area} /> : <Input {...props} />}
          </Field>
        );
      })}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-site-heading"
        actions={
          <span className="flex gap-3 text-sm">
            <Link href="/" className="underline" target="_blank" data-testid="admin-site-view">
              {t("view")}
            </Link>
            <Link href="/admin/content" className="underline">
              {t("back")}
            </Link>
          </span>
        }
      />
      <ActionForm action={saveSiteAppearanceAction} submitLabel={t("save")} testId="admin-site-form" namespace="AdminSite">
        <Card title={t("identityTitle")} description={t("identityHelp")}>
          <div className="space-y-4">
            {pair("name")}
            {pair("tagline")}
          </div>
        </Card>
        <Card title={t("announcementTitle")} description={t("announcementHelp")}>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="announcementEnabled" defaultChecked={s.announcement.enabled} data-testid="site-announcement-enabled" /> {t("fields.announcementEnabled")}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${t("fields.announcement")} (${t("persian")})`} htmlFor="site-announcement-fa">
                <Input id="site-announcement-fa" name="announcementFa" dir="rtl" maxLength={SITE_LIMITS.announcement} defaultValue={s.announcement.text.fa} data-testid="site-announcement-fa" />
              </Field>
              <Field label={`${t("fields.announcement")} (${t("english")})`} htmlFor="site-announcement-en">
                <Input id="site-announcement-en" name="announcementEn" dir="ltr" maxLength={SITE_LIMITS.announcement} defaultValue={s.announcement.text.en} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fields.announcementHref")} htmlFor="site-announcement-href" hint={t("fields.hrefHint")}>
                <Input id="site-announcement-href" name="announcementHref" dir="ltr" maxLength={SITE_LIMITS.url} defaultValue={s.announcement.href} />
              </Field>
              <Field label={t("fields.tone")} htmlFor="site-announcement-tone">
                <select id="site-announcement-tone" name="announcementTone" defaultValue={s.announcement.tone} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {ANNOUNCEMENT_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`tones.${tone}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Card>
        <Card title={t("footerTitle")} description={t("footerHelp")}>
          {pair("footerNote", true)}
        </Card>
        <Card title={t("socialTitle")} description={t("socialHelp")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_NETWORKS.map((n) => (
              <Field key={n} label={t(`social.${n}`)} htmlFor={`site-social-${n}`}>
                <Input id={`site-social-${n}`} name={`social.${n}`} type="url" dir="ltr" maxLength={SITE_LIMITS.url} defaultValue={s.social[n]} placeholder={t(`socialExample.${n}`)} data-testid={`site-social-${n}`} />
              </Field>
            ))}
          </div>
        </Card>
        <Card title={t("seoTitle")} description={t("seoHelp")}>
          <div className="space-y-4">
            {pair("seoTitle")}
            {pair("seoDescription", true)}
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
