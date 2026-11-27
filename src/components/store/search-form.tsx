import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";

/** Plain GET search form: works without JavaScript. */
export async function SearchForm({ defaultValue = "", className, testId = "search-form" }: { defaultValue?: string; className?: string; testId?: string }) {
  const t = await getTranslations("Shop");
  const locale = await getLocale();
  return (
    <form action={`/${locale}/search`} method="get" role="search" className={className} data-testid={testId}>
      <label htmlFor={`${testId}-q`} className="sr-only">
        {t("searchLabel")}
      </label>
      <div className="flex">
        <input
          id={`${testId}-q`}
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder={t("searchPlaceholder")}
          maxLength={100}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-s-md border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" className="h-11 rounded-e-md bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90">
          {t("search")}
        </button>
      </div>
    </form>
  );
}
