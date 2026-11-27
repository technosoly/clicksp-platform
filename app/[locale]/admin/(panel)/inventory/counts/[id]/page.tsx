import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { addCountLineAction, enterCountsAction, finishCountAction } from "@/modules/inventory/api/inventory-actions";
import { getCountForAdmin } from "@/modules/inventory/service/counts";
import { COUNT_TONE } from "../../tones";

export default async function AdminCountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const query = await searchParams;
  const page = Number(typeof query.page === "string" ? query.page : "1") || 1;
  const uncounted = query.show === "uncounted";
  const { data } = await adminPage(raw, (actor) => getCountForAdmin(actor, id, page, uncounted), `/admin/inventory/counts/${id}`);
  if (!data) notFound();
  const { count, lines, can } = data;
  const t = await getTranslations("AdminInventory.counts");
  const n = (v: number) => formatCount(v, locale);
  const title = (translations: { locale: string; title: string }[]) =>
    (locale === "en" ? translations.find((x) => x.locale === "en")?.title : undefined) ?? translations.find((x) => x.locale === "fa")?.title ?? "";
  const code = new Map(data.locations.map((l) => [l.id, l.code]));
  const href = (p: number, show = uncounted) => `/admin/inventory/counts/${count.id}?page=${p}${show ? "&show=uncounted" : ""}`;
  return (
    <>
      <PageHeader
        title={t("detailTitle", { name: `${count.warehouse.code} · ${count.warehouse.name}` })}
        description={count.note ?? undefined}
        testId="admin-count-heading"
        actions={
          <Link href="/admin/inventory/counts" className="text-sm underline">
            {t("all")}
          </Link>
        }
      />
      <Card>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={COUNT_TONE[count.status]} testId="admin-count-status">
            {t(`status.${count.status}`)}
          </Badge>
          <span className="text-muted-foreground">{t("progress", { counted: n(data.counted), total: n(data.total) })}</span>
          <span className="text-muted-foreground">{`${count.startedBy.name} · ${formatDate(count.startedAt, locale, { dateStyle: "medium", timeStyle: "short" })}`}</span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t(`help.${count.status}`)}</p>
        {can.enter ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {can.complete ? (
              <ActionForm action={finishCountAction} submitLabel={t("complete")} testId="admin-count-complete" namespace="AdminInventory">
                <input type="hidden" name="countId" value={count.id} />
                <input type="hidden" name="step" value="complete" />
              </ActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">{t("adminCompletes")}</p>
            )}
            <ActionForm action={finishCountAction} submitLabel={t("cancel")} submitVariant="secondary" testId="admin-count-cancel" namespace="AdminInventory">
              <input type="hidden" name="countId" value={count.id} />
              <input type="hidden" name="step" value="cancel" />
            </ActionForm>
          </div>
        ) : null}
      </Card>

      <Card title={t("linesTitle")} className="mt-4" testId="admin-count-lines">
        <p className="mb-3 flex gap-3 text-sm">
          <Link href={href(1, false)} className={uncounted ? "underline" : "font-semibold"}>
            {t("showAll")}
          </Link>
          <Link href={href(1, true)} className={uncounted ? "font-semibold" : "underline"}>
            {t("showUncounted")}
          </Link>
        </p>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noLines")}</p>
        ) : can.enter ? (
          <ActionForm action={enterCountsAction} submitLabel={t("saveCounts")} testId="admin-count-form" namespace="AdminInventory">
            <input type="hidden" name="countId" value={count.id} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pe-3 text-start font-medium">{t("location")}</th>
                    <th className="py-1 pe-3 text-start font-medium">{t("product")}</th>
                    <th className="py-1 pe-3 text-start font-medium">{t("sku")}</th>
                    <th className="py-1 pe-3 text-end font-medium">{t("expected")}</th>
                    <th className="py-1 text-end font-medium">{t("counted")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((line) => (
                    <tr key={line.id} data-testid="admin-count-line">
                      <td className="py-1.5 pe-3" dir="ltr">{code.get(line.locationId) ?? "–"}</td>
                      <td className="py-1.5 pe-3">{title(line.variant.product.translations)}</td>
                      <td className="py-1.5 pe-3" dir="ltr">{line.variant.sku}</td>
                      <td className="py-1.5 pe-3 text-end tabular-nums">{n(line.expectedQty)}</td>
                      <td className="py-1.5 text-end">
                        <input type="hidden" name="lineId" value={line.id} />
                        <Input
                          name={`qty-${line.id}`}
                          inputMode="numeric"
                          aria-label={t("countedFor", { sku: line.variant.sku })}
                          defaultValue={line.countedQty ?? ""}
                          className="ms-auto h-9 w-24 text-end"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-1.5 pe-3" dir="ltr">{code.get(line.locationId) ?? "–"}</td>
                    <td className="py-1.5 pe-3">{title(line.variant.product.translations)}</td>
                    <td className="py-1.5 pe-3" dir="ltr">{line.variant.sku}</td>
                    <td className="py-1.5 pe-3 text-end tabular-nums">{n(line.expectedQty)}</td>
                    <td className="py-1.5 text-end tabular-nums">{line.countedQty === null ? "–" : n(line.countedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.pages > 1 ? (
          <p className="mt-3 flex gap-3 text-sm">
            {data.page > 1 ? <Link href={href(data.page - 1)}>{t("previous")}</Link> : null}
            <span className="text-muted-foreground">{t("page", { page: n(data.page), pages: n(data.pages) })}</span>
            {data.page < data.pages ? <Link href={href(data.page + 1)}>{t("next")}</Link> : null}
          </p>
        ) : null}
      </Card>

      {can.enter ? (
        <Card title={t("addTitle")} description={t("addHelp")} className="mt-4">
          <ActionForm action={addCountLineAction} submitLabel={t("add")} testId="admin-count-add" namespace="AdminInventory">
            <input type="hidden" name="countId" value={count.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("sku")} htmlFor="count-sku">
                <Input id="count-sku" name="sku" dir="ltr" required maxLength={64} />
              </Field>
              <Field label={t("location")} htmlFor="count-location">
                <select id="count-location" name="locationId" className={selectClass} dir="ltr">
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code}</option>
                  ))}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
