import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { LEVEL_KEYS, roleLabel } from "@/components/admin/role-label";
import { SessionList } from "@/components/admin/session-list";
import { Input } from "@/components/ui/input";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link, redirect } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import {
  changeAdminRoleAction,
  issuePasswordLinkAction,
  resetAdminMfaAction,
  revokeAdminSessionsAction,
  setAdminStatusAction,
  setCategoryScopesAction,
  setWarehouseScopesAction,
  updateAdminUserAction,
} from "@/modules/identity/api/people-actions";
import { categoryName } from "@/components/admin/catalog-fields";
import { permissionLabel } from "@/components/admin/permission-label";
import { categoryOptions } from "@/modules/catalog/service/categories";
import { assignableRoles, getCategoryScopes, getManagedAdmin, getWarehouseScopes } from "@/modules/identity/service/admin-users";
import { warehouseChoices } from "@/modules/inventory/service/stock";

export default async function AdminUserPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(
    locale,
    async (actor) => {
      const detail = await getManagedAdmin(actor, id);
      if (detail.status !== "ok") return { detail, roles: [], scopes: null, categories: [], warehouseScopes: null, warehouses: [] };
      const scopes = await getCategoryScopes(actor, id);
      const categories = scopes && scopes.length > 0 && actor.permissions.has("product.view") ? await categoryOptions(actor, "product.view") : [];
      const warehouseScopes = await getWarehouseScopes(actor, id);
      const warehouses = warehouseScopes && warehouseScopes.length > 0 ? await warehouseChoices(actor) : [];
      return { detail, roles: await assignableRoles(actor), scopes, categories, warehouseScopes, warehouses };
    },
    `/admin/people/users/${id}`,
  );
  if (data.detail.status !== "ok") notFound();
  const { user, level, isSelf, sessions } = data.detail;
  if (isSelf) redirect({ href: "/admin/account", locale });
  const t = await getTranslations("AdminPeople");
  const tAdmin = await getTranslations("Admin");
  const tPerm = await getTranslations("Permissions");
  const loc = isLocale(locale) ? locale : "fa";
  const hidden = <input type="hidden" name="userId" value={user.id} />;

  return (
    <>
      <PageHeader
        title={user.name || user.username || ""}
        description={t("userIntro")}
        testId="admin-user-heading"
        actions={
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={level === 1 ? "orange" : "brand"}>{roleLabel(tAdmin, user.role)}</Badge>
            <Badge tone={user.status === "active" ? "success" : "danger"} testId="admin-user-status">
              {t(`status.${user.status}`)}
            </Badge>
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("detailsTitle")}>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("fields.username")}</dt>
            <dd dir="ltr" className="text-start">{user.username}</dd>
            <dt className="text-muted-foreground">{t("createdAt")}</dt>
            <dd>{formatDate(user.createdAt, loc, { dateStyle: "medium" })}</dd>
            <dt className="text-muted-foreground">{t("lastSignInLabel")}</dt>
            <dd>{user.lastLoginAt ? formatDate(user.lastLoginAt, loc, { dateStyle: "medium", timeStyle: "short" }) : t("neverSignedIn")}</dd>
          </dl>
          <ActionForm action={updateAdminUserAction} submitLabel={t("save")} testId="admin-user-details" namespace="AdminPeople">
            {hidden}
            <Field label={t("fields.name")} htmlFor="name">
              <Input id="name" name="name" defaultValue={user.name} required maxLength={120} />
            </Field>
            <Field label={t("fields.email")} htmlFor="email" hint={t("fields.optional")}>
              <Input id="email" name="email" type="email" dir="ltr" defaultValue={user.email ?? ""} maxLength={254} />
            </Field>
          </ActionForm>
        </Card>

        <Card title={t("roleTitle")} description={t("roleHelp")}>
          <ActionForm action={changeAdminRoleAction} submitLabel={t("changeRole")} testId="admin-user-role" namespace="AdminPeople">
            {hidden}
            <Field label={t("fields.role")} htmlFor="roleId">
              <select id="roleId" name="roleId" defaultValue={user.role.id} className={selectClass}>
                {data.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleLabel(tAdmin, r)}
                    {r.isSystem ? "" : ` (${tAdmin(`levels.${LEVEL_KEYS[r.level] ?? "storeStaff"}`)})`}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Card>

        {data.scopes && data.scopes.length > 0 ? (
          <Card title={t("scopeTitle")} description={t("scopeHelp")} className="lg:col-span-2" testId="admin-user-scopes">
            {data.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("scopeNoCategories")}</p>
            ) : (
              <ActionForm action={setCategoryScopesAction} submitLabel={t("saveScope")} testId="admin-user-scope-form" namespace="AdminPeople">
                {hidden}
                <p className="text-xs text-muted-foreground">{t("scopeKeys", { keys: [...new Set(data.scopes.flatMap((s) => s.scopedKeys))].map((k) => permissionLabel(tPerm, k)).join(locale === "fa" ? "، " : ", ") })}</p>
                <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {data.categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm" style={{ paddingInlineStart: `${c.depth * 0.75}rem` }}>
                      <input type="checkbox" name="category" value={c.id} defaultChecked={data.scopes!.some((s) => s.categoryIds.includes(c.id))} />
                      {categoryName(c, locale)}
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}
          </Card>
        ) : null}

        {data.warehouseScopes && data.warehouseScopes.length > 0 ? (
          <Card title={t("warehouseScopeTitle")} description={t("warehouseScopeHelp")} className="lg:col-span-2" testId="admin-user-warehouse-scopes">
            {data.warehouses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("warehouseScopeNone")}</p>
            ) : (
              <ActionForm action={setWarehouseScopesAction} submitLabel={t("saveScope")} testId="admin-user-warehouse-scope-form" namespace="AdminPeople">
                {hidden}
                <p className="text-xs text-muted-foreground">{t("scopeKeys", { keys: [...new Set(data.warehouseScopes.flatMap((s) => s.scopedKeys))].map((k) => permissionLabel(tPerm, k)).join(locale === "fa" ? "، " : ", ") })}</p>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {data.warehouses.map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="warehouse" value={w.id} defaultChecked={data.warehouseScopes!.some((s) => s.ids.includes(w.id))} />
                      <span dir="ltr">{w.code}</span> {w.name}
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}
          </Card>
        ) : null}

        <Card title={t("passwordTitle")} description={user.hasPassword ? t("passwordHelp") : t("inviteHelp")}>
          <ActionForm action={issuePasswordLinkAction} submitLabel={user.hasPassword ? t("issueReset") : t("issueInvite")} submitVariant="secondary" testId="admin-user-password-link" namespace="AdminPeople">
            {hidden}
          </ActionForm>
        </Card>

        <Card title={t("mfaTitle")} description={user.twoFactorEnabled ? t("mfaOnHelp") : t("mfaOffHelp")}>
          {user.twoFactorEnabled ? (
            <ActionForm action={resetAdminMfaAction} submitLabel={t("resetMfa")} submitVariant="destructive" testId="admin-user-mfa-reset" namespace="AdminPeople">
              {hidden}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" className="mt-1" required />
                <span>{t("resetMfaConfirm")}</span>
              </label>
            </ActionForm>
          ) : (
            <Badge>{t("twoFactorOff")}</Badge>
          )}
        </Card>

        <Card title={t("sessionsTitle")} description={t("sessionsHelp")} className="lg:col-span-2">
          <SessionList sessions={sessions} locale={loc} />
          {sessions.length > 0 ? (
            <ActionForm action={revokeAdminSessionsAction} submitLabel={t("revokeAll")} submitVariant="outline" testId="admin-user-sessions-revoke" namespace="AdminPeople" className="mt-3">
              {hidden}
            </ActionForm>
          ) : null}
        </Card>

        <Card title={t("statusTitle")} description={user.status === "active" ? t("disableHelp") : t("enableHelp")} className="lg:col-span-2">
          <ActionForm
            action={setAdminStatusAction}
            submitLabel={user.status === "active" ? t("disable") : t("enable")}
            submitVariant={user.status === "active" ? "destructive" : "default"}
            testId="admin-user-status-form"
            namespace="AdminPeople"
          >
            {hidden}
            <input type="hidden" name="status" value={user.status === "active" ? "disabled" : "active"} />
          </ActionForm>
        </Card>
      </div>
      <Link href="/admin/people/users" className="inline-block text-sm text-brand-orange-strong underline">
        {t("backToUsers")}
      </Link>
    </>
  );
}
