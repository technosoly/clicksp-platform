import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { cancelImportAction, confirmImportAction } from "@/modules/catalog/api/import-actions";
import { getProductImport } from "@/modules/catalog/service/product-import";
import { adminPage } from "@/modules/identity/api/admin-page";
import { isRunning, STATUS_TONE } from "../status";

interface Report {
  create?: number;
  update?: number;
  invalid?: number;
  error?: string;
  detail?: string | null;
}

export default async function AdminImportJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data } = await adminPage(raw, (actor) => getProductImport(actor, id), `/admin/imports/${id}`);
  if (!data) notFound();
  const { job, problems, applied } = data;
  const t = await getTranslations("AdminImports");
  const report = (job.dryRunReport ?? {}) as Report;
  const n = (value: number | undefined) => formatCount(value ?? 0, locale);
  const rowError = (key: string) => (t.has(`rowErrors.${key}`) ? t(`rowErrors.${key}`) : t("rowErrors.other"));
  return (
    <>
      <PageHeader
        title={job.originalName}
        description={t("jobIntro")}
        testId="admin-import-job-heading"
        actions={
          <Link href="/admin/imports" className="text-sm underline">
            {t("back")}
          </Link>
        }
      />
      {isRunning(job.status) ? <AutoRefresh /> : null}
      <Card>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATUS_TONE[job.status]} testId="admin-import-status">
            {t(`status.${job.status}`)}
          </Badge>
          <span className="text-muted-foreground">{t(`statusHelp.${job.status}`)}</span>
        </p>
        {report.error ? (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="admin-import-file-error">
            {t.has(`fileErrors.${report.error}`) ? t(`fileErrors.${report.error}`, { detail: report.detail ?? "" }) : t("fileErrors.unexpected")}
          </p>
        ) : null}
        {job.status !== "uploaded" && job.status !== "validating" && !report.error ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="admin-import-report">
            <div>
              <dt className="text-muted-foreground">{t("report.create")}</dt>
              <dd className="text-lg font-semibold" data-testid="admin-import-create">{n(report.create)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("report.update")}</dt>
              <dd className="text-lg font-semibold" data-testid="admin-import-update">{n(report.update)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("report.invalid")}</dt>
              <dd className="text-lg font-semibold" data-testid="admin-import-invalid">{n(report.invalid)}</dd>
            </div>
            {job.status === "applying" || job.status === "completed" ? (
              <div>
                <dt className="text-muted-foreground">{t("report.applied")}</dt>
                <dd className="text-lg font-semibold" data-testid="admin-import-applied">{n(job.status === "completed" ? job.appliedRows : applied.length)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {job.status === "validated" ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {job.validRows > 0 ? (
              <ActionForm action={confirmImportAction} submitLabel={t("confirm", { rows: n(job.validRows) })} testId="admin-import-confirm" namespace="AdminImports">
                <input type="hidden" name="id" value={job.id} />
              </ActionForm>
            ) : null}
            <ActionForm action={cancelImportAction} submitLabel={t("cancel")} submitVariant="secondary" testId="admin-import-cancel" namespace="AdminImports">
              <input type="hidden" name="id" value={job.id} />
            </ActionForm>
          </div>
        ) : null}
      </Card>

      {problems.length > 0 ? (
        <Card title={t("problemsTitle")} description={t("problemsHelp")} className="mt-4" testId="admin-import-problems">
          <ul className="divide-y text-sm">
            {problems.map((row) => (
              <li key={row.rowNumber} className="flex flex-wrap gap-x-3 gap-y-1 py-2" data-testid="admin-import-problem">
                <span className="font-medium">{t("row", { number: n(row.rowNumber) })}</span>
                <span dir="ltr" className="font-mono text-muted-foreground">
                  {row.sku}
                </span>
                <span className="text-destructive">{row.errors.map(rowError).join(t("separator"))}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {applied.length > 0 ? (
        <Card title={t("appliedTitle")} className="mt-4" testId="admin-import-applied-rows">
          <ul className="divide-y text-sm">
            {applied.map((row) => (
              <li key={row.rowNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{t("row", { number: n(row.rowNumber) })}</span>
                {row.productId ? (
                  <Link href={`/admin/products/${row.productId}`} dir="ltr" className="font-mono underline">
                    {row.sku}
                  </Link>
                ) : null}
                <Badge tone={row.status === "created" ? "success" : "brand"}>{t(`rowStatus.${row.status}`)}</Badge>
                {row.errors.length > 0 ? <span className="text-muted-foreground">{row.errors.map(rowError).join(t("separator"))}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
