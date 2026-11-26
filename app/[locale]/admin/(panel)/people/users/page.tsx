import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { isLocale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/dates";
import { Link } from "@/lib/i18n/navigation";
import { adminPage } from "@/modules/identity/api/admin-page";
import { assignableRoles, listManagedAdmins } from "@/modules/identity/service/admin-users";
import { roleLabel } from "@/components/admin/role-label";

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data } = await adminPage(locale, async (actor) => {
    const [users, roles] = await Promise.all([listManagedAdmins(actor), assignableRoles(actor)]);
    return { users, canCreate: roles.length > 0 };
  });
  const t = await getTranslations("AdminPeople");
  const tAdmin = await getTranslations("Admin");
  const loc = isLocale(locale) ? locale : "fa";

  return (
    <>
      <PageHeader
        title={t("usersTitle")}
        description={t("usersIntro")}
        testId="admin-users-heading"
        actions={
          data.canCreate ? (
            <Button asChild>
              <Link href="/admin/people/users/new" data-testid="admin-user-new">
                {t("addAdmin")}
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        {data.users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noUsers")}</p>
        ) : (
          <ul className="divide-y" data-testid="admin-users-list">
            {data.users.map((user) => (
              <li key={user.id}>
                <Link
                  href={`/admin/people/users/${user.id}`}
                  className="flex flex-col gap-2 py-3 hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between sm:px-2"
                  data-testid="admin-user-row"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{user.name || user.username}</span>
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {user.username}
                      {user.email ? ` · ${user.email}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={user.role.level === 1 ? "orange" : "brand"}>{roleLabel(tAdmin, user.role)}</Badge>
                    {user.status !== "active" ? <Badge tone="danger">{t(`status.${user.status}`)}</Badge> : null}
                    {!user.hasPassword ? <Badge>{t("awaitingPassword")}</Badge> : null}
                    <Badge tone={user.twoFactorEnabled ? "success" : "neutral"}>{user.twoFactorEnabled ? t("twoFactorOn") : t("twoFactorOff")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {user.lastLoginAt ? t("lastSignIn", { time: formatDate(user.lastLoginAt, loc, { dateStyle: "medium" }) }) : t("neverSignedIn")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
