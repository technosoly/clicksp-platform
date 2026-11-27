import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader, selectClass } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { createAccountAction, editAccountAction, mappingAction } from "@/modules/accounting/api/accounting-actions";
import { accountingOverview } from "@/modules/accounting/service/accounting";
import { adminPage } from "@/modules/identity/api/admin-page";
import { AccountingTabs } from "../tabs";

const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
const SUBTYPES = ["general", "cash", "bank", "gateway_clearing", "receivable", "payable", "vat_payable", "inventory", "sales", "sales_returns", "shipping_income", "cogs"] as const;

export default async function AdminAccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const { data } = await adminPage(raw, (actor) => accountingOverview(actor), "/admin/accounting/accounts");
  const t = await getTranslations("AdminAccounting");
  const headings = data.accounts.filter((a) => !a.isPostable);
  const depth = new Map<string, number>();
  for (const a of data.accounts) depth.set(a.id, a.parentId ? (depth.get(a.parentId) ?? 0) + 1 : 0);
  return (
    <>
      <PageHeader title={t("accounts.title")} description={t("accounts.intro")} testId="admin-accounts-heading" />
      <AccountingTabs current="accounts" />
      <Card>
        {data.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("accounts.empty")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="admin-accounts-list">
            {data.accounts.map((a) => (
              <li key={a.id} className="py-2" data-testid="admin-account-row">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2" style={{ paddingInlineStart: `${(depth.get(a.id) ?? 0) * 1.25}rem` }}>
                    <span dir="ltr" className="font-mono">{a.code}</span>
                    <span className="font-semibold">{a.name}</span>
                    <Badge>{t(`types.${a.type}`)}</Badge>
                    {a.subtype !== "general" ? <span className="text-muted-foreground">{t(`subtypes.${a.subtype}`)}</span> : null}
                    {!a.isPostable ? <Badge tone="brand">{t("accounts.heading")}</Badge> : null}
                    {!a.isActive ? <Badge tone="danger">{t("accounts.inactive")}</Badge> : null}
                  </summary>
                  {data.can.post ? (
                    <ActionForm action={editAccountAction} submitLabel={t("save")} className="mt-2 max-w-md" namespace="AdminAccounting">
                      <input type="hidden" name="accountId" value={a.id} />
                      <Field label={t("accounts.name")} htmlFor={`name-${a.id}`}>
                        <Input id={`name-${a.id}`} name="name" defaultValue={a.name} maxLength={150} />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isPostable" defaultChecked={a.isPostable} /> {t("accounts.postable")}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isActive" defaultChecked={a.isActive} /> {t("accounts.active")}
                      </label>
                    </ActionForm>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.can.post ? (
        <Card title={t("accounts.newTitle")} description={t("accounts.newHelp")} className="mt-4">
          <ActionForm action={createAccountAction} submitLabel={t("create")} testId="admin-account-create" namespace="AdminAccounting">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("accounts.code")} htmlFor="account-code" hint={t("accounts.codeHint")}>
                <Input id="account-code" name="code" dir="ltr" maxLength={20} required />
              </Field>
              <Field label={t("accounts.name")} htmlFor="account-name">
                <Input id="account-name" name="name" maxLength={150} required />
              </Field>
              <Field label={t("accounts.type")} htmlFor="account-type">
                <select id="account-type" name="type" className={selectClass}>
                  {TYPES.map((x) => (
                    <option key={x} value={x}>{t(`types.${x}`)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("accounts.subtype")} htmlFor="account-subtype">
                <select id="account-subtype" name="subtype" className={selectClass}>
                  {SUBTYPES.map((x) => (
                    <option key={x} value={x}>{t(`subtypes.${x}`)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("accounts.parent")} htmlFor="account-parent">
                <select id="account-parent" name="parentId" className={selectClass}>
                  <option value="">{t("accounts.noParent")}</option>
                  {headings.map((h) => (
                    <option key={h.id} value={h.id}>{`${h.code} · ${h.name}`}</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="isPostable" defaultChecked /> {t("accounts.postable")}
              </label>
            </div>
          </ActionForm>
        </Card>
      ) : null}
      <Card title={t("mappings.title")} description={t("mappings.help")} className="mt-4" testId="admin-mappings">
        <span id="mappings" />
        <ul className="divide-y text-sm">
          {data.mappings.map((m) => {
            const options = data.accounts.filter((a) => a.type === m.type && a.isPostable && a.isActive);
            return (
              <li key={m.key} className="py-2" data-testid={`admin-mapping-${m.key}`}>
                <ActionForm action={mappingAction} submitLabel={t("save")} submitVariant="outline" namespace="AdminAccounting" className="grid gap-2 sm:grid-cols-[1fr_16rem] sm:items-end">
                  <input type="hidden" name="key" value={m.key} />
                  <Field label={t(`mappings.keys.${m.key}`)} htmlFor={`mapping-${m.key}`} hint={t(`mappings.hints.${m.key}`)}>
                    <select id={`mapping-${m.key}`} name="accountId" defaultValue={m.accountId ?? ""} className={selectClass} disabled={!data.can.post}>
                      <option value="">{t("mappings.none")}</option>
                      {options.map((a) => (
                        <option key={a.id} value={a.id}>{`${a.code} · ${a.name}`}</option>
                      ))}
                    </select>
                  </Field>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
