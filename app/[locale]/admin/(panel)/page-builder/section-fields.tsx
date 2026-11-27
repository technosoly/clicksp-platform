import { getTranslations } from "next-intl/server";
import { Field } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/modules/content/domain/info-page";
import { BREAKPOINTS, FIELDS, formValues, TONES, type BuilderSection } from "@/modules/pagebuilder/domain/registry";

const area = "w-full rounded-md border border-input bg-background p-2 text-base leading-7";

/** The edit form fields for one section, generated from the registry's field list. */
export async function SectionFields({ section }: { section: BuilderSection }) {
  const t = await getTranslations("AdminBuilder");
  const values = formValues(section);
  const str = (name: string) => String(values[name] ?? "");
  const key = (name: string) => `${section.id}-${name.replace(".", "-")}`;
  return (
    <>
      {FIELDS[section.type].map((f) => {
        const label = t(`fields.${f.name}`);
        if (f.kind === "localized" || f.kind === "blocks") {
          const multiline = f.kind === "blocks" || f.multiline;
          const max = f.kind === "blocks" ? LIMITS.body : f.max;
          return (
            <div key={f.name} className="grid gap-3 sm:grid-cols-2">
              {(["fa", "en"] as const).map((lang) => {
                const id = key(`${f.name}.${lang}`);
                const props = { id, name: `${f.name}.${lang}`, dir: lang === "fa" ? "rtl" : "ltr", maxLength: max, defaultValue: str(`${f.name}.${lang}`) } as const;
                return (
                  <Field key={lang} label={`${label} (${t(lang === "fa" ? "persian" : "english")})`} htmlFor={id} hint={f.kind === "blocks" && lang === "fa" ? t("blocksHint") : undefined}>
                    {multiline ? <textarea {...props} rows={f.kind === "blocks" ? 8 : 3} className={area} /> : <Input {...props} />}
                  </Field>
                );
              })}
            </div>
          );
        }
        if (f.kind === "boolean") {
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.name} defaultChecked={values[f.name] === true} /> {label}
            </label>
          );
        }
        if (f.kind === "number") {
          return (
            <Field key={f.name} label={label} htmlFor={key(f.name)} hint={t("numberHint", { min: f.min, max: f.max })}>
              <Input id={key(f.name)} name={f.name} inputMode="numeric" dir="ltr" defaultValue={str(f.name)} className="max-w-32" />
            </Field>
          );
        }
        if (f.kind === "tone") {
          return (
            <Field key={f.name} label={label} htmlFor={key(f.name)}>
              <select id={key(f.name)} name={f.name} defaultValue={str(f.name)} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {t(`tones.${tone}`)}
                  </option>
                ))}
              </select>
            </Field>
          );
        }
        return (
          <Field key={f.name} label={label} htmlFor={key(f.name)} hint={t("hrefHint")}>
            <Input id={key(f.name)} name={f.name} dir="ltr" maxLength={500} defaultValue={str(f.name)} placeholder="/c/…" />
          </Field>
        );
      })}
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">{t("visibility")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {BREAKPOINTS.map((b) => (
            <label key={b} className="flex items-center gap-2">
              <input type="checkbox" name={`show.${b}`} defaultChecked={section.visibility.breakpoints.includes(b)} /> {t(`breakpoints.${b}`)}
            </label>
          ))}
          {(["fa", "en"] as const).map((l) => (
            <label key={l} className="flex items-center gap-2">
              <input type="checkbox" name={`show.${l}`} defaultChecked={section.visibility.locales.includes(l)} /> {t(l === "fa" ? "persian" : "english")}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
