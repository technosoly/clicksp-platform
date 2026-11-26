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
  updateAdminUserAction,
} from "@/modules/identity/api/people-actions";
import { assignableRoles, getManagedAdmin } from "@/modules/identity/service/admin-users";

export default async function AdminUserPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(
    locale,
    async (actor) => {
      const detail = await getManagedAdmin(actor, id);
      return { detail, roles: detail.status === "ok" ? await assignableRoles(actor) : [] };
    },
    `/admin/people/users/${id}`,
  );
  if (data.detail.status !== "ok") notFound();
  const { user, level, isSelf, sessions } = data.detail;
  if (isSelf) redirect({ href: "/admin/account", locale });
  const t = await getTranslations("AdminPeople");
  const tAdmin = await getTranslations("Admin");
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
