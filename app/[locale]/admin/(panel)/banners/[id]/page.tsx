import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/admin-ui";
import { PictureCard } from "@/components/admin/picture-card";
import { Link } from "@/lib/i18n/navigation";
import { bannerImageAction, deleteBannerAction, saveBannerAction } from "@/modules/content/api/content-actions";
import { bannerForAdmin } from "@/modules/content/service/banners";
import { adminPage } from "@/modules/identity/api/admin-page";
import { BannerFields } from "../banner-fields";

/** A Tehran day (YYYY-MM-DD) from a stored moment, for the date fields. */
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d) : "");
/** The end is stored as the start of the day after the last day. */
const lastDay = (d: Date | null) => (d ? day(new Date(d.getTime() - 1)) : "");

export default async function AdminBannerPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { locale: raw, id } = await params;
  setRequestLocale(raw);
  const { data: banner, actor } = await adminPage(raw, (actor) => bannerForAdmin(actor, id), `/admin/banners/${id}`);
  if (!banner) notFound();
  const t = await getTranslations("AdminWebsite.banners");
  const created = (await searchParams).created;
  const canUpload = actor.permissions.has("media.upload");
  return (
    <>
      <PageHeader title={banner.fa.title} description={t("editIntro")} testId="admin-banner-heading" actions={<Link href="/admin/banners" className="text-sm underline">{t("back")}</Link>} />
      {created ? (
        <p role="status" className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success" data-testid="admin-banner-created">
          {t("createdNotice")}
        </p>
      ) : null}
      <Card>
        <ActionForm action={saveBannerAction} submitLabel={t("save")} testId="admin-banner-form" namespace="AdminWebsite">
          <input type="hidden" name="bannerId" value={banner.id} />
          <BannerFields values={{ ...banner, startsOn: day(banner.startsAt), endsOn: lastDay(banner.endsAt) }} />
        </ActionForm>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PictureCard
          title={t("desktopTitle")}
          help={t("desktopHelp")}
          renditions={banner.desktop}
          alt={banner.fa.alt}
          action={bannerImageAction}
          hidden={{ name: "bannerId", value: banner.id }}
          extra={[{ name: "which", value: "desktop" }]}
          allowRemove={false}
          canEdit={canUpload}
          testId="admin-banner-desktop"
        />
        <PictureCard
          title={t("mobileTitle")}
          help={t("mobileHelp")}
          renditions={banner.mobile}
          alt={banner.fa.alt}
          action={bannerImageAction}
          hidden={{ name: "bannerId", value: banner.id }}
          extra={[{ name: "which", value: "mobile" }]}
          canEdit={canUpload}
          testId="admin-banner-mobile"
        />
      </div>
      <Card title={t("deleteTitle")} description={t("deleteHelp")} className="mt-4">
        <ActionForm action={deleteBannerAction} submitLabel={t("delete")} submitVariant="destructive" testId="admin-banner-delete" namespace="AdminWebsite">
          <input type="hidden" name="bannerId" value={banner.id} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="yes" /> {t("deleteConfirm")}
          </label>
        </ActionForm>
      </Card>
    </>
  );
}
