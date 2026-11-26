import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { money } from "@/components/admin/catalog-fields";
import { Input } from "@/components/ui/input";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { cancelPriceRequestAction, decidePriceRequestAction } from "@/modules/catalog/api/catalog-actions";
import { listApprovalInbox, listOwnApprovalRequests } from "@/modules/catalog/service/price-approvals";
import { adminPage } from "@/modules/identity/api/admin-page";
import { authorizeAny } from "@/modules/rbac/service/authorize";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";

const STATUS_TONE: Record<string, "neutral" | "success" | "danger" | "orange" | "brand"> = {
  pending: "orange",
  approved: "brand",
  executed: "success",
  rejected: "danger",
  failed: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

type Request = Awaited<ReturnType<typeof listApprovalInbox>>[number];

export default async function AdminApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const view = (await searchParams).view === "decided" ? "decided" : "pending";
  const { data } = await adminPage(
    locale,
    async (actor) => {
      await authorizeAny(actor, ["price.update", "price.update.propose", "inventory.adjust"], "approvals");
      return {
        inbox: actor.permissions.has("price.update") ? await listApprovalInbox(actor, view) : null,
        mine: actor.permissions.has("price.update.propose") ? await listOwnApprovalRequests(actor) : null,
        unit: await getDisplayUnit(),
      };
    },
    "/admin/approvals",
  );
  const t = await getTranslations("AdminApprovals");
  const loc = isLocale(locale) ? locale : "fa";

  const summary = (r: Request) => (
    <div className="min-w-0 space-y-1">
      <p className="font-medium">
        {r.variant ? (
          <Link href={`/admin/products/${r.variant.productId}`} className="hover:text-brand-orange-strong">
            {r.variant.title ?? r.variant.sku}
          </Link>
        ) : (
          t("missingProduct")
        )}{" "}
        {r.variant ? (
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
            {r.variant.sku}
          </span>
        ) : null}
      </p>
      <p className="text-sm" data-testid="approval-change">
        {t("change", { from: money(BigInt(r.payload.previousPrice), locale, data.unit), to: money(BigInt(r.payload.price), locale, data.unit) })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("requestedBy", { name: r.requestedBy.name || r.requestedBy.username || "" })} · {formatDate(r.createdAt, loc, { dateStyle: "medium", timeStyle: "short" })}
        {r.decidedBy ? ` · ${t("decidedBy", { name: r.decidedBy.name || r.decidedBy.username || "" })}` : ""}
      </p>
      {r.decisionNote ? <p className="text-xs">{t("note", { note: r.decisionNote })}</p> : null}
      {r.error ? <p className="text-xs text-destructive">{t(`errors.${r.error === "price_changed_since_request" ? "request_stale" : "unexpected"}`)}</p> : null}
    </div>
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-approvals-heading" />
      {data.inbox ? (
        <Card title={t("inboxTitle")}>
          <nav className="mb-4 flex gap-4 text-sm">
            <Link href="/admin/approvals" className={view === "pending" ? "font-semibold text-brand-orange-strong" : ""}>
              {t("pending")}
            </Link>
            <Link href="/admin/approvals?view=decided" className={view === "decided" ? "font-semibold text-brand-orange-strong" : ""}>
              {t("decided")}
            </Link>
          </nav>
          {data.inbox.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="approvals-empty">
              {view === "pending" ? t("inboxEmpty") : t("decidedEmpty")}
            </p>
          ) : (
            <ul className="divide-y" data-testid="approvals-inbox">
              {data.inbox.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-start lg:justify-between" data-testid="approval-row">
                  {summary(r)}
                  {r.status === "pending" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={decidePriceRequestAction} submitLabel={t("approve")} testId="approval-approve" namespace="AdminApprovals" className="flex items-end gap-2 space-y-0">
                        <input type="hidden" name="approvalId" value={r.id} />
                        <input type="hidden" name="decision" value="approve" />
                      </ActionForm>
                      <ActionForm action={decidePriceRequestAction} submitLabel={t("reject")} submitVariant="outline" testId="approval-reject" namespace="AdminApprovals" className="flex items-end gap-2 space-y-0">
                        <input type="hidden" name="approvalId" value={r.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <Input name="note" placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")} maxLength={1000} className="h-10 w-44" />
                      </ActionForm>
                    </div>
                  ) : (
                    <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {data.mine ? (
        <Card title={t("mineTitle")} description={t("mineHelp")}>
          {data.mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mineEmpty")}</p>
          ) : (
            <ul className="divide-y" data-testid="approvals-mine">
              {data.mine.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="approval-mine-row">
                  {summary(r)}
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                    {r.status === "pending" ? (
                      <ActionForm action={cancelPriceRequestAction} submitLabel={t("withdraw")} submitVariant="ghost" namespace="AdminApprovals">
                        <input type="hidden" name="approvalId" value={r.id} />
                      </ActionForm>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
