/**
 * What the customer types at checkout. Everything else on the order (prices,
 * shipping cost, totals, the phone number of the account) comes from the
 * server.
 */
import { z } from "zod";
import { normalizeForStorage, toEnDigits } from "@/lib/persian-text";
import { isProvinceCode } from "@/modules/shipping/service/provinces";
import { normalizeIranianMobile } from "@/modules/identity/service/phone";

const text = (min: number, max: number, error: string) => z.string().transform((v) => normalizeForStorage(v).trim()).pipe(z.string().min(min, error).max(max, error));
const optional = (max: number, error: string) => z.string().transform((v) => normalizeForStorage(toEnDigits(v)).trim() || null).pipe(z.string().max(max, error).nullable());

export const checkoutInputSchema = z.object({
  recipientName: text(2, 160, "invalid_name"),
  phone: z.string().transform((v, ctx) => {
    const phone = normalizeIranianMobile(v);
    if (!phone) ctx.addIssue({ code: "custom", message: "invalid_phone" });
    return phone ?? "";
  }),
  provinceCode: z.string().refine(isProvinceCode, "invalid_province"),
  city: text(2, 100, "invalid_city"),
  addressLine: text(5, 500, "invalid_address"),
  plaque: optional(20, "invalid_plaque"),
  unit: optional(20, "invalid_unit"),
  postalCode: z.string().transform((v) => toEnDigits(v).replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{10}$/, "invalid_postal_code")),
  shippingMethodId: z.uuid("choose_shipping"),
  note: optional(1000, "invalid_note"),
  saveAddress: z.boolean(),
});

export type CheckoutInput = z.input<typeof checkoutInputSchema>;
export type CheckoutData = z.output<typeof checkoutInputSchema>;

/** How long a new order holds its stock while it awaits payment. */
export const PAYMENT_WINDOW_HOURS = 24;
