/** Whole numbers (quantities, counts) in the locale's digits: ۱٬۲۳۴ or 1,234. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(value);
}
