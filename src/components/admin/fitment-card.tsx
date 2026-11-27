import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, selectClass } from "@/components/admin/admin-ui";
import { localName } from "@/components/admin/vehicle-fields";
import { Input } from "@/components/ui/input";
import { addFitmentAction, fitmentCommandAction } from "@/modules/compatibility/api/fitment-actions";
import { POSITIONS, SOURCE_TYPES, type VerificationStatusKey } from "@/modules/compatibility/domain/fitment-input";
import type { fitmentForAdmin } from "@/modules/compatibility/service/fitment";
import type { motorcyclePicker } from "@/modules/vehicles/service/motorcycles";
import { yearRange } from "@/modules/vehicles/domain/vehicle-input";

type Fitment = NonNullable<Awaited<ReturnType<typeof fitmentForAdmin>>>;
type Picker = Awaited<ReturnType<typeof motorcyclePicker>>;

const TONE: Record<VerificationStatusKey, "neutral" | "success" | "orange" | "danger"> = {
  unverified: "neutral",
  verified: "success",
  disputed: "orange",
  rejected: "danger",
};

/** "Fits these motorcycles" on the product screen. */
export async function FitmentCard({ productId, fitment, picker, locale }: { productId: string; fitment: Fitment; picker: Picker; locale: string }) {
  const t = await getTranslations("AdminFitment");
  const tv = await getTranslations("AdminVehicles");
  const hidden = <input type="hidden" name="productId" value={productId} />;
  const years = (from: number | null, to: number | null) => yearRange(from, to, tv("now"));

  return (
    <Card title={t("title")} description={t("help")} testId="admin-product-fitment">
      {fitment.links.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="admin-fitment-empty">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {fitment.links.map((link) => {
            const m = link.motorcycle;
            const label = [
              `${localName(nameOnly(m.brand), locale)} ${localName(nameOnly(m.model), locale)}`,
              years(link.yearFrom ?? m.generation.yearFrom, link.yearTo ?? (link.yearFrom ? link.yearFrom : m.generation.yearTo)),
              m.variant ? [localName(nameOnly(m.variant.name), locale), m.variant.cc ? tv("cc", { cc: m.variant.cc }) : null].filter(Boolean).join(" ") : t("wholeGeneration"),
              link.position !== "any" ? t(`positions.${link.position}`) : null,
              link.quantity ? `×${link.quantity}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const commands = [
              ...(fitment.can.verify ? (["verified", "disputed", "rejected", "unverified"] as const).filter((c) => c !== link.status) : []),
              ...(fitment.can.manage && (link.status !== "verified" || fitment.can.verify) ? (["remove"] as const) : []),
            ];
            return (
              <li key={link.id} className="space-y-2 py-3" data-testid="admin-fitment-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[link.status]} testId="admin-fitment-status">
                    {t(`statuses.${link.status}`)}
                  </Badge>
                  <span className="font-medium">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("sourceLabel", { title: `${t(`sourceTypes.${link.source.type}`)}: ${link.source.title}${link.source.reference ? ` (${link.source.reference})` : ""}` })}
                  {link.verifiedBy ? ` · ${t("verifiedBy", { name: link.verifiedBy })}` : ""}
                  {link.notes ? ` · ${link.notes}` : ""}
                </p>
                {commands.length ? (
                  <div className="flex flex-wrap gap-2">
                    {commands.map((command) => (
                      <ActionForm
                        key={command}
                        action={fitmentCommandAction}
                        submitLabel={t(`commands.${command}`)}
                        submitVariant={command === "remove" || command === "rejected" ? "destructive" : command === "verified" ? "default" : "ghost"}
                        namespace="AdminFitment"
                        testId={`admin-fitment-${command}`}
                      >
                        {hidden}
                        <input type="hidden" name="linkId" value={link.id} />
                        <input type="hidden" name="command" value={command} />
                      </ActionForm>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {fitment.can.manage ? (
        picker.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("noMotorcycles")}</p>
        ) : (
          <ActionForm action={addFitmentAction} submitLabel={t("add")} submitVariant="secondary" testId="admin-fitment-add" namespace="AdminFitment" className="mt-4 rounded-lg border p-3">
            {hidden}
            <Field label={t("motorcycle")} htmlFor="fitTarget">
              <select id="fitTarget" name="target" className={selectClass} required defaultValue="">
                <option value="" disabled>
                  {tv("choose")}
                </option>
                {picker.map((model) => (
                  <optgroup key={model.id} label={`${localName(model.brandNames, locale)} ${localName(model.names, locale)}`}>
                    {model.generations.flatMap((g) => [
                      <option key={g.id} value={`g:${g.id}`}>
                        {`${years(g.yearFrom, g.yearTo)}${g.code ? ` ${g.code}` : ""} · ${t("wholeGeneration")}`}
                      </option>,
                      ...g.variants.map((v) => (
                        <option key={v.id} value={`v:${v.id}`}>
                          {`${years(v.yearFrom ?? g.yearFrom, v.yearTo ?? (v.yearFrom ? v.yearTo : g.yearTo))} · ${localName(v.names, locale)}${v.engineDisplacementCc ? ` ${tv("cc", { cc: v.engineDisplacementCc })}` : ""}`}
                        </option>
                      )),
                    ])}
                  </optgroup>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={tv("fields.yearFrom")} htmlFor="fitYearFrom" hint={t("yearsHint")}>
                <Input id="fitYearFrom" name="yearFrom" inputMode="numeric" dir="ltr" maxLength={4} />
              </Field>
              <Field label={tv("fields.yearTo")} htmlFor="fitYearTo">
                <Input id="fitYearTo" name="yearTo" inputMode="numeric" dir="ltr" maxLength={4} />
              </Field>
              <Field label={t("position")} htmlFor="fitPosition">
                <select id="fitPosition" name="position" className={selectClass} defaultValue="any">
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {t(`positions.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("quantity")} htmlFor="fitQuantity">
                <Input id="fitQuantity" name="quantity" inputMode="numeric" dir="ltr" maxLength={3} />
              </Field>
            </div>
            <Field label={t("notes")} htmlFor="fitNotes">
              <Input id="fitNotes" name="notes" maxLength={1000} />
            </Field>
            <Field label={t("source")} htmlFor="fitSource">
              <select id="fitSource" name="sourceId" className={selectClass} defaultValue="">
                <option value="">{t("newSource")}</option>
                {fitment.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`${t(`sourceTypes.${s.type}`)}: ${s.title}${s.reference ? ` (${s.reference})` : ""}`}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("sourceType")} htmlFor="fitSourceType">
                <select id="fitSourceType" name="sourceType" className={selectClass} defaultValue="oem_catalog">
                  {SOURCE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`sourceTypes.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("sourceTitle")} htmlFor="fitSourceTitle" hint={t("sourceTitleHint")}>
                <Input id="fitSourceTitle" name="sourceTitle" maxLength={200} />
              </Field>
              <Field label={t("sourceReference")} htmlFor="fitSourceReference">
                <Input id="fitSourceReference" name="sourceReference" maxLength={200} />
              </Field>
              <Field label={t("sourceUrl")} htmlFor="fitSourceUrl">
                <Input id="fitSourceUrl" name="sourceUrl" type="url" dir="ltr" maxLength={500} />
              </Field>
            </div>
          </ActionForm>
        )
      ) : null}
    </Card>
  );
}

function nameOnly(names: Partial<Record<"fa" | "en", string>>) {
  return { fa: names.fa ? { name: names.fa } : undefined, en: names.en ? { name: names.en } : undefined };
}
