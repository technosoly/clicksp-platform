import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Card, Field } from "@/components/admin/admin-ui";
import { CatalogImage } from "@/components/media/catalog-image";
import type { ActionState } from "@/modules/identity/api/admin-action";
import type { Rendition } from "@/modules/media/domain/image-rules";

/** One picture (brand logo, category image): preview, replace and remove. */
export async function PictureCard({
  title,
  help,
  renditions,
  alt,
  action,
  hidden,
  canEdit,
  testId,
  extra = [],
  allowRemove = true,
}: {
  title: string;
  help: string;
  renditions: Rendition[];
  alt: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  hidden: { name: string; value: string };
  canEdit: boolean;
  testId: string;
  /** More hidden fields the action needs. */
  extra?: { name: string; value: string }[];
  /** Whether the picture may be removed (some are required). */
  allowRemove?: boolean;
}) {
  const t = await getTranslations("AdminCatalog");
  return (
    <Card title={title} description={help} testId={testId}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="overflow-hidden rounded-md border">
          <CatalogImage renditions={renditions} alt={alt} sizes="12rem" width={320} testId={`${testId}-image`} />
        </div>
        {canEdit ? (
          <div className="space-y-3">
            <ActionForm action={action} submitLabel={renditions.length ? t("replaceImage") : t("addImage")} submitVariant="secondary" namespace="AdminCatalog" testId={`${testId}-upload`}>
              <input type="hidden" name={hidden.name} value={hidden.value} />
              {extra.map((e) => (
                <input key={e.name} type="hidden" name={e.name} value={e.value} />
              ))}
              <Field label={t("fields.image")} htmlFor={`${testId}-file`} hint={t("fields.imageHint")}>
                <input id={`${testId}-file`} name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required className="block w-full text-sm" />
              </Field>
            </ActionForm>
            {renditions.length && allowRemove ? (
              <ActionForm action={action} submitLabel={t("removeImage")} submitVariant="ghost" namespace="AdminCatalog" testId={`${testId}-remove`}>
                <input type="hidden" name={hidden.name} value={hidden.value} />
                {extra.map((e) => (
                  <input key={e.name} type="hidden" name={e.name} value={e.value} />
                ))}
                <input type="hidden" name="command" value="remove" />
              </ActionForm>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("imageNoPermission")}</p>
        )}
      </div>
    </Card>
  );
}
