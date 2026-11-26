import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { LEVEL_KEYS, roleLabel } from "@/components/admin/role-label";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { canEditRoleLevel } from "@/modules/rbac/domain/escalation";
import { createRoleAction } from "@/modules/rbac/api/role-actions";
import { listRoles } from "@/modules/rbac/service/roles";

export default async function AdminRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: roles, ctx } = await adminPage(locale, (actor) => listRoles(actor));
  const t = await getTranslations("AdminRoles");
  const tAdmin = await getTranslations("Admin");
  const format = await getFormatter();
  const creatableLevels = [2, 3].filter((level) => canEditRoleLevel(ctx.level, level));

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-roles-heading" />
      <ul className="grid gap-3 md:grid-cols-2" data-testid="admin-roles-list">
        {roles.map((role) => (
          <li key={role.id}>
            <Link href={`/admin/people/roles/${role.id}`} className="block h-full rounded-xl border bg-card p-4 hover:border-brand-orange" data-testid="admin-role-row">
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{roleLabel(tAdmin, role)}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={role.level === 1 ? "orange" : "brand"}>{tAdmin(`levels.${LEVEL_KEYS[role.level] ?? "storeStaff"}`)}</Badge>
                  {role.isSystem ? <Badge>{t("system")}</Badge> : <Badge>{t("custom")}</Badge>}
                  {role.isActive ? null : <Badge tone="danger">{t("inactive")}</Badge>}
                </span>
              </span>
              {role.description ? <span className="mt-1 block text-sm text-muted-foreground">{role.description}</span> : null}
              <span className="mt-3 block text-xs text-muted-foreground">
                {t("counts", { members: format.number(role.memberCount), permissions: format.number(role.permissionCount) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {creatableLevels.length > 0 ? (
        <Card title={t("createTitle")} description={t("createHelp")}>
          <ActionForm action={createRoleAction} submitLabel={t("create")} testId="admin-role-create" namespace="AdminRoles">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.name")} htmlFor="name">
                <Input id="name" name="name" required maxLength={100} />
              </Field>
              <Field label={t("fields.key")} htmlFor="key" hint={t("fields.keyHint")}>
                <Input id="key" name="key" required dir="ltr" maxLength={50} autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label={t("fields.level")} htmlFor="level" hint={t("fields.levelHint")}>
                <select id="level" name="level" className={selectClass} defaultValue="3">
                  {creatableLevels.map((level) => (
                    <option key={level} value={level}>
                      {tAdmin(`levels.${LEVEL_KEYS[level]}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("fields.description")} htmlFor="description" hint={t("fields.optional")}>
                <Input id="description" name="description" maxLength={500} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
