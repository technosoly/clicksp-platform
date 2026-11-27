import { formatMoney, type DisplayUnit } from "@/lib/money";

/** A price from integer Rial, shown in the store's display unit; a struck-through old price when there is one. */
export function Price({ amount, compareAt, locale, unit, size = "md", testId }: { amount: bigint; compareAt?: bigint | null; locale: "fa" | "en"; unit: DisplayUnit; size?: "md" | "lg"; testId?: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={size === "lg" ? "text-2xl font-extrabold" : "font-bold"} data-testid={testId}>
        {formatMoney(amount, { locale, unit })}
      </span>
      {compareAt ? <s className="text-sm text-muted-foreground">{formatMoney(compareAt, { locale, unit })}</s> : null}
    </span>
  );
}
