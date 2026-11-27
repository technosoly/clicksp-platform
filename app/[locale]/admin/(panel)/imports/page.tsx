import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { formatDate } from "@/lib/i18n/dates";
import { formatCount } from "@/lib/i18n/numbers";
import { Link } from "@/lib/i18n/navigation";
import { uploadImportAction } from "@/modules/catalog/api/import-actions";
import { IMPORT_COLUMNS, IMPORT_LIMITS } from "@/modules/catalog/domain/product-import";
import { listProductImports } from "@/modules/catalog/service/product-import";
import { adminPage } from "@/modules/identity/api/admin-page";
import { isRunning, STATUS_TONE } from "./status";

export default async function AdminImportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data: jobs } = await adminPage(raw, (actor) => listProductImports(actor), "/admin/imports");
  const t = await getTranslations("AdminImports");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-imports-heading" />
      {jobs.some((j) => isRunning(j.status)) ? <AutoRefresh /> : null}
      <Card title={t("uploadTitle")} description={t("uploadHelp", { rows: formatCount(IMPORT_LIMITS.rows, locale) })}>
        <ActionForm action={uploadImportAction} submitLabel={t("upload")} testId="admin-import-upload" namespace="AdminImports">
          <Field label={t("file")} htmlFor="import-file" hint={t("fileHint")}>
            <input id="import-file" name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm" />
          </Field>
        </ActionForm>
        <div className="mt-4 space-y-2 text-sm">
          <a href="/templates/products-import.csv" download className="font-medium underline" data-testid="admin-import-template">
            {t("template")}
          </a>
          <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
            {IMPORT_COLUMNS.map((column) => (
              <li key={column}>
                <code dir="ltr" className="font-mono text-foreground">
                  {column}
                </code>
                {": "}
                {t(`columns.${column}`)}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card title={t("jobsTitle")} className="mt-4" testId="admin-import-jobs">
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noJobs")}</p>
        ) : (
          <ul className="divide-y">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-import-job">
                <Link href={`/admin/imports/${job.id}`} className="min-w-0 truncate font-medium hover:underline" dir="auto">
                  {job.originalName}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(job.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <Badge tone={STATUS_TONE[job.status]} testId="admin-import-job-status">
                    {t(`status.${job.status}`)}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
