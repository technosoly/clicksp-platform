import { getTranslations } from "next-intl/server";
import { Field } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";

/** Warehouse form fields shared by the create and edit screens. */
export async function WarehouseFields({ w }: { w?: { code: string; name: string; city: string | null; address: string | null; phone: string | null; priority: number } }) {
  const t = await getTranslations("AdminInventory");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fields.code")} htmlFor="code" hint={t("fields.codeHint")}>
          <Input id="code" name="code" dir="ltr" required maxLength={32} defaultValue={w?.code} className="max-w-48 uppercase" />
        </Field>
        <Field label={t("fields.name")} htmlFor="name">
          <Input id="name" name="name" required maxLength={120} defaultValue={w?.name} />
        </Field>
        <Field label={t("fields.city")} htmlFor="city">
          <Input id="city" name="city" maxLength={100} defaultValue={w?.city ?? ""} />
        </Field>
        <Field label={t("fields.phone")} htmlFor="phone">
          <Input id="phone" name="phone" dir="ltr" inputMode="tel" maxLength={20} defaultValue={w?.phone ?? ""} />
        </Field>
      </div>
      <Field label={t("fields.address")} htmlFor="address">
        <Input id="address" name="address" maxLength={500} defaultValue={w?.address ?? ""} />
      </Field>
      <Field label={t("fields.priority")} htmlFor="priority" hint={t("fields.priorityHint")}>
        <Input id="priority" name="priority" inputMode="numeric" dir="ltr" maxLength={4} defaultValue={String(w?.priority ?? 100)} className="max-w-28" />
      </Field>
    </>
  );
}
