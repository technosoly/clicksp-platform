import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { money, moneyInputValue, ProductDetailsFields } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import {
  addIdentifierAction,
  addVariantAction,
  changeCostAction,
  changePriceAction,
  removeIdentifierAction,
  setProductStatusAction,
  updateProductAction,
  updateVariantAction,
} from "@/modules/catalog/api/catalog-actions";
import { IDENTIFIER_TYPES } from "@/modules/catalog/domain/catalog-input";
import { brandOptions } from "@/modules/catalog/service/brands";
import { categoryOptions } from "@/modules/catalog/service/categories";
import { getProductForAdmin } from "@/modules/catalog/service/products";
import { adminPage } from "@/modules/identity/api/admin-page";

const STATUS_TONE = { draft: "neutral", active: "success", archived: "danger" } as const;
const CREATED_MESSAGES = new Set(["productCreated", "productCreatedPriceProposed"]);

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const created = (await searchParams).created;
  const { data } = await adminPage(
    locale,
    async (actor) => {
      const detail = await getProductForAdmin(actor, id);
      if (!detail) return null;
      const editable = detail.can.edit;
      return {
        detail,
        categories: editable ? await categoryOptions(actor, "product.update") : [],
        brands: editable ? await brandOptions(actor) : [],
      };
    },
    `/admin/products/${id}`,
  );
  if (!data) notFound();
  const { product, unit, can, publishProblems } = data.detail;
  const t = await getTranslations("AdminCatalog");
  const loc = isLocale(locale) ? locale : "fa";
  const title = (locale === "en" ? product.translations.find((x) => x.locale === "en")?.title : undefined) ?? product.translations.find((x) => x.locale === "fa")?.title ?? "";
  const hiddenProduct = <input type="hidden" name="productId" value={product.id} />;
  const unitLabel = t(`units.${unit}`);
  const statusActions: { status: string; label: string; variant: "default" | "secondary" | "destructive" }[] = [];
  if (can.edit && product.status === "draft") statusActions.push({ status: "active", label: t("publish"), variant: "default" });
  if (can.edit && product.status === "active") statusActions.push({ status: "draft", label: t("unpublish"), variant: "secondary" });
  if (can.archive && product.status !== "archived") statusActions.push({ status: "archived", label: t("archive"), variant: "destructive" });
  if (can.archive && product.status === "archived") statusActions.push({ status: "draft", label: t("restore"), variant: "secondary" });

  return (
    <>
      <PageHeader
        title={title}
        description={t("productEditIntro")}
        testId="admin-product-heading"
        actions={
          <Badge tone={STATUS_TONE[product.status]} testId="admin-product-status">
            {t(`status.${product.status}`)}
          </Badge>
        }
      />
      {typeof created === "string" && CREATED_MESSAGES.has(created) ? (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success" data-testid="admin-product-created">
          {t(`messages.${created}`)}
        </p>
      ) : null}

      {statusActions.length > 0 ? (
        <Card title={t("visibilityTitle")} description={product.status === "draft" && publishProblems.length > 0 ? t(`problems.${publishProblems[0]}`) : t(`visibility.${product.status}`)}>
          <div className="flex flex-wrap gap-2">
            {statusActions.map((a) => (
              <ActionForm key={a.status} action={setProductStatusAction} submitLabel={a.label} submitVariant={a.variant} testId={`admin-product-status-${a.status}`} namespace="AdminCatalog">
                {hiddenProduct}
                <input type="hidden" name="status" value={a.status} />
              </ActionForm>
            ))}
          </div>
        </Card>
      ) : null}

      {can.edit ? (
        <Card title={t("detailsTitle")}>
          <ActionForm action={updateProductAction} submitLabel={t("save")} testId="admin-product-details" namespace="AdminCatalog">
            {hiddenProduct}
            <ProductDetailsFields
              values={{ ...product, categoryIds: product.categories.map((c) => c.categoryId) }}
              categories={data.categories}
              brands={data.brands}
              locale={locale}
            />
          </ActionForm>
        </Card>
      ) : null}

      <section className="space-y-3" data-testid="admin-product-variants">
        <h2 className="text-lg font-semibold">{t("variantsTitle")}</h2>
        {product.variants.map((v) => (
          <Card key={v.id} testId="admin-variant">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm" dir="ltr">
                  {v.sku}
                </p>
                <p className="mt-1 text-xl font-bold" data-testid="admin-variant-price">
                  {v.price > 0n ? money(v.price, locale, unit) : t("noPrice")}
                </p>
                {v.compareAtPrice ? <p className="text-sm text-muted-foreground line-through">{money(v.compareAtPrice, locale, unit)}</p> : null}
              </div>
              <span className="flex flex-wrap gap-1">
                {v.isDefault ? <Badge tone="brand">{t("mainVariant")}</Badge> : null}
                {v.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                {v.pendingApproval ? <Badge tone="orange" testId="admin-variant-pending">{t("pricePending")}</Badge> : null}
              </span>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {can.setPrice || can.proposePrice ? (
                <ActionForm
                  action={changePriceAction}
                  submitLabel={can.setPrice ? t("savePrice") : t("proposePrice")}
                  testId="admin-variant-price-form"
                  namespace="AdminCatalog"
                  className="rounded-lg border p-3"
                >
                  <input type="hidden" name="variantId" value={v.id} />
                  <p className="text-sm font-medium">{can.setPrice ? t("priceTitle") : t("proposeTitle")}</p>
                  {can.setPrice ? null : <p className="text-xs text-muted-foreground">{t("proposeHelp")}</p>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("fields.priceIn", { unit: unitLabel })} htmlFor={`price-${v.id}`}>
                      <Input id={`price-${v.id}`} name="price" inputMode="decimal" dir="ltr" defaultValue={moneyInputValue(v.price, unit)} />
                    </Field>
                    <Field label={t("fields.compareAtIn", { unit: unitLabel })} htmlFor={`compare-${v.id}`}>
                      <Input id={`compare-${v.id}`} name="compareAtPrice" inputMode="decimal" dir="ltr" defaultValue={moneyInputValue(v.compareAtPrice, unit)} />
                    </Field>
                  </div>
                </ActionForm>
              ) : null}

              {can.seeCost ? (
                can.editCost ? (
                  <ActionForm action={changeCostAction} submitLabel={t("saveCost")} submitVariant="secondary" testId="admin-variant-cost-form" namespace="AdminCatalog" className="rounded-lg border p-3">
                    <input type="hidden" name="variantId" value={v.id} />
                    <Field label={t("fields.costIn", { unit: unitLabel })} htmlFor={`cost-${v.id}`} hint={t("fields.costHint")}>
                      <Input id={`cost-${v.id}`} name="costPrice" inputMode="decimal" dir="ltr" defaultValue={moneyInputValue(v.costPrice, unit)} />
                    </Field>
                  </ActionForm>
                ) : (
                  <p className="text-sm">
                    {t("fields.cost")}: {v.costPrice ? money(v.costPrice, locale, unit) : "—"}
                  </p>
                )
              ) : null}
            </div>

            {v.history.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">{t("priceHistory")}</summary>
                <ul className="mt-2 divide-y text-sm" data-testid="admin-variant-history">
                  {v.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {money(h.price, locale, unit)}
                        {h.approvalId ? <Badge tone="brand">{t("viaApproval")}</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {h.changedBy ? (h.changedBy.name || h.changedBy.username) : t("system")} · {formatDate(h.createdAt, loc, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {can.edit ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">{t("variantDetails")}</summary>
                <ActionForm action={updateVariantAction} submitLabel={t("save")} submitVariant="secondary" testId="admin-variant-edit" namespace="AdminCatalog" className="mt-3">
                  <input type="hidden" name="variantId" value={v.id} />
                  <VariantFields idPrefix={v.id} values={v} t={t} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isActive" defaultChecked={v.isActive} />
                    {t("fields.isActive")}
                  </label>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        ))}
        {can.edit ? (
          <Card title={t("addVariant")} description={t("addVariantHelp")}>
            <ActionForm action={addVariantAction} submitLabel={t("addVariant")} submitVariant="secondary" testId="admin-variant-add" namespace="AdminCatalog">
              {hiddenProduct}
              <VariantFields idPrefix="new" t={t} />
            </ActionForm>
          </Card>
        ) : null}
      </section>

      <Card title={t("identifiersTitle")} description={t("identifiersHelp")} testId="admin-product-identifiers">
        {product.identifiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("identifiersEmpty")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {product.identifiers.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2" data-testid="admin-identifier-row">
                <span>
                  <Badge>{t(`identifierTypes.${i.type}`)}</Badge>{" "}
                  <span className="font-mono" dir="ltr">
                    {i.value}
                  </span>
                </span>
                {can.edit ? (
                  <ActionForm action={removeIdentifierAction} submitLabel={t("remove")} submitVariant="ghost" namespace="AdminCatalog">
                    {hiddenProduct}
                    <input type="hidden" name="identifierId" value={i.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {can.edit ? (
          <ActionForm action={addIdentifierAction} submitLabel={t("addIdentifier")} submitVariant="secondary" testId="admin-identifier-add" namespace="AdminCatalog" className="mt-4">
            {hiddenProduct}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fields.identifierType")} htmlFor="identifierType">
                <select id="identifierType" name="type" className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base">
                  {IDENTIFIER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`identifierTypes.${type}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("fields.identifierValue")} htmlFor="identifierValue" hint={t("fields.identifierHint")}>
                <Input id="identifierValue" name="value" dir="ltr" maxLength={100} required spellCheck={false} />
              </Field>
            </div>
          </ActionForm>
        ) : null}
      </Card>

      <Link href="/admin/products" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToProducts")}
      </Link>
    </>
  );
}

function VariantFields({
  idPrefix,
  values,
  t,
}: {
  idPrefix: string;
  values?: { sku: string; weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; minOrderQty: number; maxOrderQty: number | null };
  t: (key: string) => string;
}) {
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const field = (name: string, label: string, value: string, required = false) => (
    <Field label={label} htmlFor={`${idPrefix}-${name}`}>
      <Input id={`${idPrefix}-${name}`} name={name} dir="ltr" inputMode={name === "sku" ? "text" : "numeric"} defaultValue={value} required={required} />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {field("sku", t("fields.sku"), values?.sku ?? "", true)}
      {field("weightGrams", t("fields.weight"), num(values?.weightGrams))}
      {field("lengthMm", t("fields.length"), num(values?.lengthMm))}
      {field("widthMm", t("fields.width"), num(values?.widthMm))}
      {field("heightMm", t("fields.height"), num(values?.heightMm))}
      {field("minOrderQty", t("fields.minQty"), num(values?.minOrderQty ?? 1))}
      {field("maxOrderQty", t("fields.maxQty"), num(values?.maxOrderQty))}
    </div>
  );
}
