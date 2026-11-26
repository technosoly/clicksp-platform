import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { LEVEL_KEYS, roleLabel } from "@/components/admin/role-label";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { createAdminUserAction } from "@/modules/identity/api/people-actions";
import { assignableRoles, listManagedAdmins } from "@/modules/identity/service/admin-users";

export default async function NewAdminUserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data: roles } = await adminPage(locale, async (actor) => {
    await listManagedAdmins(actor); // authorizes: 403 when the actor manages nobody
    return assignableRoles(actor);
  });
  const t = await getTranslations("AdminPeople");
  const tAdmin = await getTranslations("Admin");
  return (
    <>
      <PageHeader title={t("addAdmin")} description={t("addAdminIntro")} testId="admin-user-new-heading" />
      <Card>
        <ActionForm action={createAdminUserAction} submitLabel={t("create")} testId="admin-user-create" namespace="AdminPeople" hideAfterLink>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={120} autoComplete="off" />
            </Field>
            <Field label={t("fields.username")} htmlFor="username" hint={t("fields.usernameHint")}>
              <Input id="username" name="username" required dir="ltr" autoCapitalize="none" spellCheck={false} maxLength={50} autoComplete="off" />
            </Field>
            <Field label={t("fields.email")} htmlFor="email" hint={t("fields.optional")}>
              <Input id="email" name="email" type="email" dir="ltr" maxLength={254} autoComplete="off" />
            </Field>
            <Field label={t("fields.role")} htmlFor="roleId">
              <select id="roleId" name="roleId" required className={selectClass} defaultValue="">
                <option value="" disabled>
                  {t("fields.chooseRole")}
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleLabel(tAdmin, r)}
                    {r.isSystem ? "" : ` (${tAdmin(`levels.${LEVEL_KEYS[r.level] ?? "storeStaff"}`)})`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">{t("createHelp")}</p>
        </ActionForm>
      </Card>
      <Link href="/admin/people/users" className="inline-block text-sm text-brand-orange-strong underline" data-testid="admin-back-to-users">
        {t("backToUsers")}
      </Link>
    </>
  );
}
