import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/admin/admin-ui";
import { CatalogImage } from "@/components/media/catalog-image";
import { Link } from "@/lib/i18n/navigation";
import { createBannerAction } from "@/modules/content/api/content-actions";
import { bannersForAdmin } from "@/modules/content/service/banners";
import { adminPage } from "@/modules/identity/api/admin-page";
import { BannerFields, EMPTY_BANNER } from "./banner-fields";

export default async function AdminBannersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const { data: banners, actor } = await adminPage(raw, (actor) => bannersForAdmin(actor), "/admin/banners");
  const t = await getTranslations("AdminWebsite.banners");
  const deleted = (await searchParams).deleted;
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} testId="admin-banners-heading" />
      {deleted ? (
        <p role="status" className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {t("deleted")}
        </p>
      ) : null}
      <Card>
        {banners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="admin-banners-list">
            {banners.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-banner-row">
                <div className="w-28 overflow-hidden rounded border">
                  <CatalogImage renditions={b.desktop} alt="" sizes="7rem" width={320} />
                </div>
                <Link href={`/admin/banners/${b.id}`} className="font-semibold underline" lang="fa" dir="rtl">
                  {b.title}
                </Link>
                <Badge tone={b.live ? "success" : "neutral"}>{t(b.live ? "live" : b.isActive ? "scheduled" : "off")}</Badge>
                <span className="ms-auto text-xs text-muted-foreground">{t("order", { n: b.sortOrder })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {actor.permissions.has("media.upload") ? (
        <Card title={t("new")} description={t("newHelp")} className="mt-4">
          <ActionForm action={createBannerAction} submitLabel={t("create")} testId="admin-banner-create" namespace="AdminWebsite">
            <input type="hidden" name="placement" value="home_hero" />
            <Field label={t("fields.desktopImage")} htmlFor="banner-image" hint={t("fields.desktopImageHint")}>
              <input id="banner-image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required className="block w-full text-sm" />
            </Field>
            <BannerFields values={EMPTY_BANNER} />
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
