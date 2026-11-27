import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { saveMenuAction } from "@/modules/content/api/content-actions";
import { MENU_LABEL_MAX } from "@/modules/content/domain/menu";
import { menusForAdmin } from "@/modules/content/service/menus";
import { adminPage } from "@/modules/identity/api/admin-page";

export default async function AdminMenusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const { data: menus } = await adminPage(raw, (actor) => menusForAdmin(actor), "/admin/menus");
  const t = await getTranslations("AdminWebsite.menus");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-menus-heading" />
      <div className="space-y-4">
        {menus.map((menu) => (
          <Card key={menu.key} title={t(`keys.${menu.key}`)} description={t(`help.${menu.key}`)} testId={`admin-menu-${menu.key}`}>
            <ActionForm action={saveMenuAction} submitLabel={t("save")} testId={`admin-menu-${menu.key}-form`} namespace="AdminWebsite">
              <input type="hidden" name="key" value={menu.key} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pe-2 text-start font-medium">{t("faLabel")}</th>
                      <th className="py-1 pe-2 text-start font-medium">{t("enLabel")}</th>
                      <th className="py-1 text-start font-medium">{t("link")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menu.rows.map((row, i) => (
                      <tr key={i}>
                        <td className="py-1 pe-2">
                          <Input name={`fa-${i}`} dir="rtl" maxLength={MENU_LABEL_MAX} defaultValue={row.fa} aria-label={t("rowFa", { n: i + 1 })} />
                        </td>
                        <td className="py-1 pe-2">
                          <Input name={`en-${i}`} dir="ltr" maxLength={MENU_LABEL_MAX} defaultValue={row.en} aria-label={t("rowEn", { n: i + 1 })} />
                        </td>
                        <td className="py-1">
                          <Input name={`href-${i}`} dir="ltr" maxLength={500} defaultValue={row.href} placeholder="/c/…" aria-label={t("rowLink", { n: i + 1 })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
