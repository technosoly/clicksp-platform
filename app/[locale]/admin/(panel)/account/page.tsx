import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { BackupCodesForm } from "@/components/admin/backup-codes-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { LEVEL_KEYS } from "@/components/admin/role-label";
import { SessionList } from "@/components/admin/session-list";
import { Input } from "@/components/ui/input";
import { isLocale } from "@/lib/i18n/config";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/password";
import { changeOwnPasswordAction, revokeOwnOtherSessionsAction, revokeOwnSessionAction } from "@/modules/identity/api/account-actions";
import { adminPage } from "@/modules/identity/api/admin-page";
import { getOwnAccount } from "@/modules/identity/service/account";

export default async function AdminAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { data, ctx } = await adminPage(locale, (actor) => getOwnAccount(actor));
  const t = await getTranslations("AdminAccount");
  const tAdmin = await getTranslations("Admin");
  const tPeople = await getTranslations("AdminPeople");
  const loc = isLocale(locale) ? locale : "fa";
  const { user, sessions, backupCodesLeft } = data;
  const others = sessions.filter((s) => !s.current).length;

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-account-heading" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("profileTitle")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{tPeople("fields.name")}</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">{tPeople("fields.username")}</dt>
            <dd dir="ltr" className="text-start">{user.username}</dd>
            <dt className="text-muted-foreground">{tPeople("fields.email")}</dt>
            <dd dir="ltr" className="text-start">{user.email ?? "—"}</dd>
            <dt className="text-muted-foreground">{tAdmin("yourRole")}</dt>
            <dd>{tAdmin(`levels.${LEVEL_KEYS[ctx.level] ?? "storeStaff"}`)}</dd>
            <dt className="text-muted-foreground">{tAdmin("twoFactor")}</dt>
            <dd>
              <Badge tone={user.twoFactorEnabled ? "success" : "neutral"}>{user.twoFactorEnabled ? tAdmin("twoFactorOn") : tAdmin("twoFactorOff")}</Badge>
            </dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{t("profileHelp")}</p>
        </Card>
        <Card title={t("passwordTitle")} description={t("passwordHelp", { min: PASSWORD_MIN_LENGTH })}>
          <ActionForm action={changeOwnPasswordAction} submitLabel={t("changePassword")} testId="admin-change-password" namespace="AdminAccount">
            <Field label={t("current")} htmlFor="current">
              <Input id="current" name="current" type="password" autoComplete="current-password" required dir="ltr" />
            </Field>
            <Field label={t("new")} htmlFor="next">
              <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} dir="ltr" />
            </Field>
            <Field label={t("confirm")} htmlFor="confirm">
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required dir="ltr" />
            </Field>
          </ActionForm>
        </Card>
        {backupCodesLeft !== null ? (
          <Card title={t("backupCodesTitle")} description={t("backupCodesHelp")}>
            <BackupCodesForm left={backupCodesLeft} />
          </Card>
        ) : null}
        <Card title={t("sessionsTitle")} description={t("sessionsHelp")} className="lg:col-span-2">
          <SessionList
            sessions={sessions}
            locale={loc}
            action={(s) =>
              s.current ? null : (
                <ActionForm action={revokeOwnSessionAction} submitLabel={t("signOutDevice")} submitVariant="outline" namespace="AdminAccount" className="space-y-1">
                  <input type="hidden" name="sessionId" value={s.id} />
                </ActionForm>
              )
            }
          />
          {others > 0 ? (
            <ActionForm action={revokeOwnOtherSessionsAction} submitLabel={t("signOutOthers")} submitVariant="secondary" testId="admin-signout-others" namespace="AdminAccount" className="mt-3" />
          ) : null}
        </Card>
      </div>
    </>
  );
}
