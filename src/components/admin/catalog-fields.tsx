import { getTranslations } from "next-intl/server";
import { Field, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatMoney, type DisplayUnit } from "@/lib/money";

/** Form pieces shared by the catalog screens (server components). */

type Names = Partial<Record<"fa" | "en", { name: string; slug: string } | undefined>>;

/** Persian (required) and English (optional) name with optional slugs. */
export async function NameFields({ names, idPrefix = "" }: { names?: Names; idPrefix?: string }) {
  const t = await getTranslations("AdminCatalog");
  const id = (name: string) => `${idPrefix}${name}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset className="space-y-3 rounded-lg border p-3" lang="fa" dir="rtl">
        <legend className="px-1 text-sm font-semibold">{t("persian")}</legend>
        <Field label={t("fields.name")} htmlFor={id("faName")}>
          <Input id={id("faName")} name="faName" defaultValue={names?.fa?.name ?? ""} required maxLength={150} />
        </Field>
        <Field label={t("fields.slug")} htmlFor={id("faSlug")} hint={t("fields.slugHint")}>
          <Input id={id("faSlug")} name="faSlug" defaultValue={names?.fa?.slug ?? ""} maxLength={150} />
        </Field>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3" lang="en" dir="ltr">
        <legend className="px-1 text-sm font-semibold">{t("english")}</legend>
        <Field label={t("fields.nameEn")} htmlFor={id("enName")} hint={t("fields.optionalEn")}>
          <Input id={id("enName")} name="enName" defaultValue={names?.en?.name ?? ""} maxLength={150} />
        </Field>
        <Field label={t("fields.slug")} htmlFor={id("enSlug")} hint={t("fields.slugHint")}>
          <Input id={id("enSlug")} name="enSlug" defaultValue={names?.en?.slug ?? ""} maxLength={150} />
        </Field>
      </fieldset>
    </div>
  );
}

export interface CategoryOption {
  id: string;
  depth: number;
  isActive: boolean;
  names: Names;
}

/** A category's label in the current language (Persian when English is missing). */
export function categoryName(category: { names: Names }, locale: string): string {
  return (locale === "en" ? category.names.en?.name : undefined) ?? category.names.fa?.name ?? "";
}

/** <option>s for a category <select>, indented by depth. */
export function CategoryOptions({ categories, locale, inactiveLabel }: { categories: CategoryOption[]; locale: string; inactiveLabel: string }) {
  return (
    <>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {`${"  ".repeat(c.depth)}${c.depth > 0 ? "› " : ""}${categoryName(c, locale)}${c.isActive ? "" : ` (${inactiveLabel})`}`}
        </option>
      ))}
    </>
  );
}

/** A Rial amount in the store's display unit, in the page language. */
export function money(amount: bigint, locale: string, unit: DisplayUnit): string {
  return formatMoney(amount, { locale: locale === "en" ? "en" : "fa", unit });
}

/** The value to put in a price input (display unit, no grouping, ASCII digits). */
export function moneyInputValue(amount: bigint | null, unit: DisplayUnit): string {
  if (amount === null || amount === 0n) return "";
  return formatMoney(amount, { locale: "en", unit, digits: "en", label: false }).replace(/,/g, "");
}

interface ProductFieldValues {
  translations: { locale: string; title: string; slug: string; shortDescription: string | null }[];
  brandId: string | null;
  primaryCategoryId: string | null;
  categoryIds: string[];
  warrantyMonths: number | null;
}

/** Titles in both languages, categories, brand and warranty (new and edit product forms). */
export async function ProductDetailsFields({
  values,
  categories,
  brands,
  locale,
}: {
  values?: ProductFieldValues;
  categories: CategoryOption[];
  brands: { id: string; isActive: boolean; names: Names }[];
  locale: string;
}) {
  const t = await getTranslations("AdminCatalog");
  const fa = values?.translations.find((x) => x.locale === "fa");
  const en = values?.translations.find((x) => x.locale === "en");
  const extra = new Set((values?.categoryIds ?? []).filter((id) => id !== values?.primaryCategoryId));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border p-3" lang="fa" dir="rtl">
          <legend className="px-1 text-sm font-semibold">{t("persian")}</legend>
          <Field label={t("fields.title")} htmlFor="faTitle">
            <Input id="faTitle" name="faTitle" defaultValue={fa?.title ?? ""} required maxLength={250} />
          </Field>
          <Field label={t("fields.slug")} htmlFor="faSlug" hint={t("fields.slugHint")}>
            <Input id="faSlug" name="faSlug" defaultValue={fa?.slug ?? ""} maxLength={150} />
          </Field>
          <Field label={t("fields.short")} htmlFor="faShort">
            <textarea id="faShort" name="faShort" defaultValue={fa?.shortDescription ?? ""} maxLength={1000} rows={3} className="w-full rounded-md border border-input bg-background p-2 text-base" />
          </Field>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3" lang="en" dir="ltr">
          <legend className="px-1 text-sm font-semibold">{t("english")}</legend>
          <Field label={t("fields.titleEn")} htmlFor="enTitle" hint={t("fields.optionalEn")}>
            <Input id="enTitle" name="enTitle" defaultValue={en?.title ?? ""} maxLength={250} />
          </Field>
          <Field label={t("fields.slug")} htmlFor="enSlug" hint={t("fields.slugHint")}>
            <Input id="enSlug" name="enSlug" defaultValue={en?.slug ?? ""} maxLength={150} />
          </Field>
          <Field label={t("fields.shortEn")} htmlFor="enShort">
            <textarea id="enShort" name="enShort" defaultValue={en?.shortDescription ?? ""} maxLength={1000} rows={3} className="w-full rounded-md border border-input bg-background p-2 text-base" />
          </Field>
        </fieldset>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("fields.primaryCategory")} htmlFor="primaryCategoryId">
          <select id="primaryCategoryId" name="primaryCategoryId" className={selectClass} defaultValue={values?.primaryCategoryId ?? ""} required>
            <option value="" disabled>
              {t("choose")}
            </option>
            <CategoryOptions categories={categories} locale={locale} inactiveLabel={t("inactive")} />
          </select>
        </Field>
        <Field label={t("fields.brand")} htmlFor="brandId">
          <select id="brandId" name="brandId" className={selectClass} defaultValue={values?.brandId ?? ""}>
            <option value="">{t("noBrand")}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {categoryName(b, locale)}
                {b.isActive ? "" : ` (${t("inactive")})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.warranty")} htmlFor="warrantyMonths" hint={t("fields.warrantyHint")}>
          <Input id="warrantyMonths" name="warrantyMonths" inputMode="numeric" dir="ltr" defaultValue={values?.warrantyMonths?.toString() ?? ""} />
        </Field>
      </div>
      {categories.length > 1 ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("fields.extraCategories")}</summary>
          <p className="mt-1 text-xs text-muted-foreground">{t("fields.extraCategoriesHint")}</p>
          <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm" style={{ paddingInlineStart: `${c.depth * 0.75}rem` }}>
                <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={extra.has(c.id)} />
                {categoryName(c, locale)}
              </label>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
