import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { permissionLabel, moduleLabel } from "@/components/admin/permission-label";
import { LEVEL_KEYS, roleLabel } from "@/components/admin/role-label";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { setRolePermissionsAction, updateRoleAction } from "@/modules/rbac/api/role-actions";
import { getRoleDetail, type PermissionCell } from "@/modules/rbac/service/roles";

export default async function AdminRolePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, (actor) => getRoleDetail(actor, id), `/admin/people/roles/${id}`);
  if (!data) notFound();
  const t = await getTranslations("AdminRoles");
  const tAdmin = await getTranslations("Admin");
  const tPerm = await getTranslations("Permissions");
  const { role, editable, cells } = data;

  const modules = new Map<string, PermissionCell[]>();
  for (const cell of cells) modules.set(cell.module, [...(modules.get(cell.module) ?? []), cell]);
  const hidden = <input type="hidden" name="roleId" value={role.id} />;
  const matrix = (
    <div className="space-y-5">
      {[...modules.entries()].map(([module, list]) => (
        <fieldset key={module} className="rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">{moduleLabel(tPerm, module)}</legend>
          <ul className="divide-y">
            {list.map((cell) => (
              <li key={cell.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`perm-${cell.key}`}>
                <label className={`flex items-start gap-2 text-sm ${cell.allowedForLevel ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    name={`grant:${cell.key}`}
                    defaultChecked={cell.granted}
                    disabled={!cell.editable}
                    className="mt-1"
                    data-testid={`grant-${cell.key}`}
                  />
                  <span>
                    <span className="block">{permissionLabel(tPerm, cell.key)}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {cell.key}
                    </span>
                  </span>
                </label>
                <span className="flex flex-wrap items-center gap-2 ps-6 sm:ps-0">
                  {cell.requiresMfa ? <Badge tone="orange">{t("needsMfa")}</Badge> : null}
                  {!cell.allowedForLevel ? <Badge>{t("notForLevel")}</Badge> : null}
                  {cell.scopeType ? (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name={`scoped:${cell.key}`} defaultChecked={cell.scoped} disabled={!cell.editable} />
                      {t(cell.scopeType === "category" ? "scopedCategory" : "scopedWarehouse")}
                    </label>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title={roleLabel(tAdmin, role)}
        description={role.description ?? undefined}
        testId="admin-role-heading"
        actions={
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={role.level === 1 ? "orange" : "brand"}>{tAdmin(`levels.${LEVEL_KEYS[role.level] ?? "storeStaff"}`)}</Badge>
            {role.isSystem ? <Badge>{t("system")}</Badge> : <Badge>{t("custom")}</Badge>}
          </span>
        }
      />
      {editable ? null : (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="admin-role-readonly">
          {data.isMember ? t("readonlyMember") : t("readonlyLevel")}
        </p>
      )}
      {editable ? (
        <Card title={t("detailsTitle")}>
          <ActionForm action={updateRoleAction} submitLabel={t("save")} testId="admin-role-details" namespace="AdminRoles">
            {hidden}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.name")} htmlFor="name">
                <Input id="name" name="name" defaultValue={role.name} required maxLength={100} />
              </Field>
              <Field label={t("fields.description")} htmlFor="description" hint={t("fields.optional")}>
                <Input id="description" name="description" defaultValue={role.description ?? ""} maxLength={500} />
              </Field>
            </div>
            {role.isSystem ? (
              <input type="hidden" name="isActive" value="on" />
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={role.isActive} />
                {t("fields.active")}
              </label>
            )}
          </ActionForm>
        </Card>
      ) : null}
      <Card title={t("permissionsTitle")} description={t("permissionsHelp")}>
        {editable ? (
          <ActionForm action={setRolePermissionsAction} submitLabel={t("savePermissions")} testId="admin-role-permissions" namespace="AdminRoles">
            {hidden}
            {matrix}
          </ActionForm>
        ) : (
          matrix
        )}
      </Card>
      <Link href="/admin/people/roles" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToRoles")}
      </Link>
    </>
  );
}
