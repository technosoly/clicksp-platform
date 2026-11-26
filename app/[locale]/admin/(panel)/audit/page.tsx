import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import { adminPage } from "@/modules/identity/api/admin-page";
import { holds } from "@/modules/rbac/domain/authorize";
import { listAuditTrail, listSecurityLog } from "@/modules/audit/service/audit-view";

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const tab = query.tab === "security" ? "security" : "audit";
  const { data, ctx } = await adminPage(locale, async (actor) =>
    tab === "security"
      ? { kind: "security" as const, ...(await listSecurityLog(actor, { page: query.page })) }
      : { kind: "audit" as const, ...(await listAuditTrail(actor, { page: query.page })) },
  );
  const t = await getTranslations("AdminAudit");
  const format = await getFormatter();
  const loc = isLocale(locale) ? locale : "fa";
  const canSeeSecurity = holds(ctx.permissions, "audit.view_all");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (page: number) => `/admin/audit?${tab === "security" ? "tab=security&" : ""}page=${page}`;
  const when = (d: Date) => formatDate(d, loc, { dateStyle: "short", timeStyle: "medium" });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={data.kind === "audit" && data.scope === "business" ? t("introBusiness") : t("intro")}
        testId="admin-audit-heading"
      />
      {canSeeSecurity ? (
        <nav className="flex gap-2" aria-label={t("tabs")}>
          {(["audit", "security"] as const).map((key) => (
            <Link
              key={key}
              href={key === "audit" ? "/admin/audit" : "/admin/audit?tab=security"}
              aria-current={tab === key ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", tab === key ? "border-secondary bg-secondary text-secondary-foreground" : "bg-card")}
            >
              {t(`tab.${key}`)}
            </Link>
          ))}
        </nav>
      ) : null}
      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : data.kind === "audit" ? (
          <ul className="divide-y" data-testid="audit-list">
            {data.rows.map((row) => (
              <li key={row.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[11rem_1fr_auto] sm:items-baseline sm:gap-4">
                <span className="text-xs text-muted-foreground">{when(row.occurredAt)}</span>
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold" dir="ltr">
                    {row.action}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {row.actorUser ? row.actorUser.name || row.actorUser.username : t(`actorType.${row.actorType}`)}
                    {" · "}
                    <span dir="ltr">
                      {row.entityType}
                      {row.entityId ? ` ${row.entityId.slice(0, 8)}` : ""}
                    </span>
                  </span>
                </span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {row.ipAddress ?? ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y" data-testid="security-list">
            {data.rows.map((row) => (
              <li key={row.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[11rem_1fr_auto] sm:items-baseline sm:gap-4">
                <span className="text-xs text-muted-foreground">{when(row.occurredAt)}</span>
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold" dir="ltr">
                    {row.type}
                  </span>{" "}
                  <Badge tone={row.severity === "critical" ? "danger" : row.severity === "warning" ? "orange" : "neutral"}>{t(`severity.${row.severity}`)}</Badge>
                  {row.user ? <span className="block text-xs text-muted-foreground">{row.user.name || row.user.username}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {row.ipAddress ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t("pagination")}>
            {data.page > 1 ? (
              <Link href={href(data.page - 1)} className="text-brand-orange-strong underline">
                {t("newer")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">{t("pageOf", { page: format.number(data.page), pages: format.number(pages) })}</span>
            {data.page < pages ? (
              <Link href={href(data.page + 1)} className="text-brand-orange-strong underline">
                {t("older")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
