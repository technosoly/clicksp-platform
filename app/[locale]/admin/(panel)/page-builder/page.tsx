import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { discardDraftAction, editSectionAction, publishAction, restoreAction } from "@/modules/pagebuilder/api/builder-actions";
import { DOCUMENT_LIMITS, SECTION_TYPES } from "@/modules/pagebuilder/domain/registry";
import { builderForAdmin } from "@/modules/pagebuilder/service/builder";
import { SectionFields } from "./section-fields";

export default async function PageBuilderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw === "en" ? "en" : "fa";
  const { data: b } = await adminPage(raw, (actor) => builderForAdmin(actor), "/admin/page-builder");
  const t = await getTranslations("AdminBuilder");
  const when = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: "medium", timeStyle: "short" }) : "");
  const sections = b.document.sections;
  const base = <input type="hidden" name="base" value={b.base} />;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        testId="admin-builder-heading"
        actions={
          <Link href="/preview/home" className="text-sm underline" target="_blank" data-testid="admin-builder-preview">
            {t("preview")}
          </Link>
        }
      />

      <Card testId="admin-builder-status">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={b.source === "draft" ? "orange" : "neutral"} testId="admin-builder-source">
            {t(`source.${b.source}`)}
          </Badge>
          {b.draft ? <span className="text-muted-foreground">{t("draftBy", { date: when(b.draft.at), name: b.draft.by })}</span> : null}
          {b.published ? <span className="text-muted-foreground">{t("publishedBy", { n: b.published.revisionNo, date: when(b.published.at), name: b.published.by ?? "—" })}</span> : null}
        </div>
        {b.draft ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {b.canPublish ? (
              <ActionForm action={publishAction} submitLabel={t("publish")} testId="admin-builder-publish" namespace="AdminBuilder">
                {base}
                <Field label={t("note")} htmlFor="builder-note">
                  <Input id="builder-note" name="note" maxLength={500} />
                </Field>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">{t("publishNotAllowed")}</p>
            )}
            <ActionForm action={discardDraftAction} submitLabel={t("discard")} submitVariant="secondary" testId="admin-builder-discard" namespace="AdminBuilder">
              {base}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" /> {t("discardConfirm")}
              </label>
            </ActionForm>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("noDraft")}</p>
        )}
      </Card>

      <ol className="mt-4 space-y-3" data-testid="admin-builder-sections">
        {sections.map((s, i) => (
          <li key={s.id} className="rounded-xl border bg-card" data-testid={`admin-builder-section-${s.type}`}>
            <details>
              <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="font-semibold">{t(`types.${s.type}.label`)}</span>
                {s.visibility.breakpoints.length < 3 || s.visibility.locales.length < 2 ? <Badge>{t("limited")}</Badge> : null}
              </summary>
              <div className="space-y-4 border-t p-4">
                <p className="text-sm text-muted-foreground">{t(`types.${s.type}.help`)}</p>
                <ActionForm action={editSectionAction} submitLabel={t("saveSection")} testId={`admin-builder-edit-${s.id}`} namespace="AdminBuilder">
                  {base}
                  <input type="hidden" name="command" value="update" />
                  <input type="hidden" name="sectionId" value={s.id} />
                  <input type="hidden" name="type" value={s.type} />
                  <SectionFields section={s} />
                </ActionForm>
                <div className="flex flex-wrap items-start gap-3 border-t pt-4">
                  {i > 0 ? (
                    <ActionForm action={editSectionAction} submitLabel={t("moveUp")} submitVariant="secondary" testId={`admin-builder-up-${s.id}`} namespace="AdminBuilder">
                      {base}
                      <input type="hidden" name="command" value="up" />
                      <input type="hidden" name="sectionId" value={s.id} />
                    </ActionForm>
                  ) : null}
                  {i < sections.length - 1 ? (
                    <ActionForm action={editSectionAction} submitLabel={t("moveDown")} submitVariant="secondary" testId={`admin-builder-down-${s.id}`} namespace="AdminBuilder">
                      {base}
                      <input type="hidden" name="command" value="down" />
                      <input type="hidden" name="sectionId" value={s.id} />
                    </ActionForm>
                  ) : null}
                  <ActionForm action={editSectionAction} submitLabel={t("remove")} submitVariant="destructive" testId={`admin-builder-remove-${s.id}`} namespace="AdminBuilder" className="ms-auto">
                    {base}
                    <input type="hidden" name="command" value="remove" />
                    <input type="hidden" name="sectionId" value={s.id} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="confirm" value="yes" /> {t("removeConfirm")}
                    </label>
                  </ActionForm>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ol>
      {sections.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p> : null}

      <Card title={t("addTitle")} description={t("addHelp", { max: DOCUMENT_LIMITS.sections })} className="mt-4">
        <ActionForm action={editSectionAction} submitLabel={t("add")} testId="admin-builder-add" namespace="AdminBuilder">
          {base}
          <input type="hidden" name="command" value="add" />
          <Field label={t("type")} htmlFor="builder-type">
            <select id="builder-type" name="type" className="h-10 rounded-md border border-input bg-background px-2 text-sm">
              {SECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}.label`)}
                </option>
              ))}
            </select>
          </Field>
        </ActionForm>
      </Card>

      <Card title={t("historyTitle")} description={t("historyHelp")} className="mt-4" testId="admin-builder-history">
        {b.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {b.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-semibold tabular-nums">#{h.revisionNo}</span>
                <Badge tone={h.status === "published" ? "success" : "neutral"}>{t(`revision.${h.status}`)}</Badge>
                <span className="text-muted-foreground">{t("historyLine", { date: when(h.at), name: h.by ?? "—", n: h.sections })}</span>
                {h.restoredFrom ? <span className="text-muted-foreground">{t("restoredFrom", { n: h.restoredFrom })}</span> : null}
                {h.note ? <span className="text-muted-foreground">«{h.note}»</span> : null}
                {b.canPublish && h.status !== "published" ? (
                  <ActionForm action={restoreAction} submitLabel={t("restore")} submitVariant="secondary" testId={`admin-builder-restore-${h.revisionNo}`} namespace="AdminBuilder" className="ms-auto flex items-center gap-3 space-y-0">
                    {base}
                    <input type="hidden" name="revisionId" value={h.id} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="confirm" value="yes" /> {t("restoreConfirm")}
                    </label>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
