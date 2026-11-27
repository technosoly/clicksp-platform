import { getTranslations } from "next-intl/server";
import { Field } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { BANNER_LIMITS } from "@/modules/content/domain/banner";

export type BannerValues = {
  href: string;
  sortOrder: number;
  isActive: boolean;
  startsOn: string;
  endsOn: string;
  fa: { title: string; subtitle: string; cta: string; alt: string };
  en: { title: string; subtitle: string; cta: string; alt: string };
};

export const EMPTY_BANNER: BannerValues = { href: "", sortOrder: 0, isActive: true, startsOn: "", endsOn: "", fa: { title: "", subtitle: "", cta: "", alt: "" }, en: { title: "", subtitle: "", cta: "", alt: "" } };

/** A banner's text, link, order and dates. */
export async function BannerFields({ values }: { values: BannerValues }) {
  const t = await getTranslations("AdminWebsite.banners");
  const language = (lang: "fa" | "en") => (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">{t(lang === "fa" ? "persian" : "english")}</legend>
      {lang === "en" ? <p className="text-xs text-muted-foreground">{t("englishHint")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fields.title")} htmlFor={`banner-${lang}-title`}>
          <Input id={`banner-${lang}-title`} name={`${lang}Title`} dir={lang === "fa" ? "rtl" : "ltr"} required={lang === "fa"} maxLength={BANNER_LIMITS.title} defaultValue={values[lang].title} />
        </Field>
        <Field label={t("fields.subtitle")} htmlFor={`banner-${lang}-subtitle`}>
          <Input id={`banner-${lang}-subtitle`} name={`${lang}Subtitle`} dir={lang === "fa" ? "rtl" : "ltr"} maxLength={BANNER_LIMITS.subtitle} defaultValue={values[lang].subtitle} />
        </Field>
        <Field label={t("fields.cta")} htmlFor={`banner-${lang}-cta`} hint={t("fields.ctaHint")}>
          <Input id={`banner-${lang}-cta`} name={`${lang}Cta`} dir={lang === "fa" ? "rtl" : "ltr"} maxLength={BANNER_LIMITS.cta} defaultValue={values[lang].cta} />
        </Field>
        <Field label={t("fields.alt")} htmlFor={`banner-${lang}-alt`} hint={t("fields.altHint")}>
          <Input id={`banner-${lang}-alt`} name={`${lang}Alt`} dir={lang === "fa" ? "rtl" : "ltr"} maxLength={BANNER_LIMITS.alt} defaultValue={values[lang].alt} />
        </Field>
      </div>
    </fieldset>
  );
  return (
    <>
      {language("fa")}
      {language("en")}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fields.href")} htmlFor="banner-href" hint={t("fields.hrefHint")}>
          <Input id="banner-href" name="href" dir="ltr" maxLength={500} defaultValue={values.href} placeholder="/c/…" />
        </Field>
        <Field label={t("fields.sortOrder")} htmlFor="banner-order">
          <Input id="banner-order" name="sortOrder" inputMode="numeric" dir="ltr" defaultValue={String(values.sortOrder)} />
        </Field>
        <Field label={t("fields.startsOn")} htmlFor="banner-starts" hint={t("fields.datesHint")}>
          <Input id="banner-starts" name="startsOn" type="date" dir="ltr" defaultValue={values.startsOn} />
        </Field>
        <Field label={t("fields.endsOn")} htmlFor="banner-ends">
          <Input id="banner-ends" name="endsOn" type="date" dir="ltr" defaultValue={values.endsOn} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} /> {t("fields.isActive")}
      </label>
    </>
  );
}
