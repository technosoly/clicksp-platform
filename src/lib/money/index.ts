/**
 * The central currency service. This is the ONLY place where money is
 * converted, rounded or formatted.
 *
 * - Internal currency: Iranian Rial (IRR), always an integer, held as `bigint`
 *   and stored in PostgreSQL as BIGINT.
 * - Toman is a display unit only (1 Toman = 10 Rial). Nothing outside this
 *   module may divide or multiply by 10 to convert.
 * - No floating point arithmetic on money, anywhere.
 */
import { toEnDigits, toFaDigits } from "../persian-text";

/** An amount in integer Rial. */
export type Rial = bigint;

export const CURRENCY_CODE = "IRR" as const;
export const RIAL_PER_TOMAN = 10n;

export type DisplayUnit = "toman" | "rial";
export type DigitSet = "fa" | "en";
export type MoneyLocale = "fa" | "en";

/**
 * Rounding policy for derived amounts (percent discounts, tax, proportional
 * splits). Defined once here and selected by store settings, never ad hoc.
 * - half_up:   ties away from zero (1.5 -> 2, -1.5 -> -2)
 * - half_even: ties to the even neighbour (banker's rounding)
 * - down:      toward zero (truncate)
 * - up:        away from zero
 */
export type RoundingMode = "half_up" | "half_even" | "down" | "up";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Labels for each unit and language. The single source of currency labels. */
export const CURRENCY_LABELS: Record<MoneyLocale, Record<DisplayUnit, string>> = {
  fa: { toman: "تومان", rial: "ریال" },
  en: { toman: "Toman", rial: "Rial" },
};

const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Builds a Rial amount from a trusted integer source (DB value, validated
 * input). Rejects fractions, non-finite numbers and unsafe JS integers.
 */
export function rial(value: bigint | number | string): Rial {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`Rial amount must be a safe integer, got ${value}`);
    }
    return BigInt(value);
  }
  const text = value.trim();
  if (!INTEGER_PATTERN.test(text)) {
    throw new MoneyError(`Rial amount must be an integer string, got "${value}"`);
  }
  return BigInt(text);
}

export const ZERO: Rial = 0n;

export function add(...amounts: Rial[]): Rial {
  return amounts.reduce((acc, a) => acc + a, 0n);
}

/** Sum of a list (alias kept for readability at call sites). */
export const sum = add;

export function subtract(a: Rial, b: Rial): Rial {
  return a - b;
}

/** Unit price times an integer quantity. */
export function multiply(amount: Rial, quantity: number | bigint): Rial {
  const q = typeof quantity === "bigint" ? quantity : BigInt(assertSafeInteger(quantity, "quantity"));
  return amount * q;
}

export function negate(amount: Rial): Rial {
  return -amount;
}

export function abs(amount: Rial): Rial {
  return amount < 0n ? -amount : amount;
}

export function min(a: Rial, b: Rial): Rial {
  return a < b ? a : b;
}

export function max(a: Rial, b: Rial): Rial {
  return a > b ? a : b;
}

export function isNegative(amount: Rial): boolean {
  return amount < 0n;
}

/**
 * Integer division of two bigints with an explicit rounding mode.
 * The divisor must be positive.
 */
export function divideRounded(numerator: bigint, divisor: bigint, mode: RoundingMode): bigint {
  if (divisor <= 0n) throw new MoneyError("Divisor must be positive");
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  let q = n / divisor;
  const r = n % divisor;
  if (r !== 0n) {
    const twice = r * 2n;
    switch (mode) {
      case "down":
        break;
      case "up":
        q += 1n;
        break;
      case "half_up":
        if (twice >= divisor) q += 1n;
        break;
      case "half_even":
        if (twice > divisor || (twice === divisor && q % 2n === 1n)) q += 1n;
        break;
    }
  }
  return negative ? -q : q;
}

/**
 * A percentage of an amount, expressed in basis points (1% = 100 bp,
 * 12.5% = 1250 bp), rounded to whole Rial with the given mode.
 */
export function applyPercent(amount: Rial, basisPoints: number, rounding: RoundingMode): Rial {
  const bp = BigInt(assertSafeInteger(basisPoints, "basisPoints"));
  return divideRounded(amount * bp, 10_000n, rounding);
}

/**
 * Price after a percentage discount. The discount itself is rounded with
 * `rounding`; the result is never below zero.
 */
export function discountByPercent(amount: Rial, basisPoints: number, rounding: RoundingMode): Rial {
  if (basisPoints < 0 || basisPoints > 10_000) {
    throw new MoneyError(`Discount must be between 0 and 10000 basis points, got ${basisPoints}`);
  }
  return max(amount - applyPercent(amount, basisPoints, rounding), 0n);
}

/** Price after a fixed discount, never below zero. */
export function discountByAmount(amount: Rial, discount: Rial): Rial {
  if (discount < 0n) throw new MoneyError("Discount amount must not be negative");
  return max(amount - discount, 0n);
}

/** Rounds an amount to a store-configured step (e.g. 1000 Rial). */
export function roundToStep(amount: Rial, step: Rial, mode: RoundingMode): Rial {
  if (step <= 0n) throw new MoneyError("Rounding step must be positive");
  return divideRounded(amount, step, mode) * step;
}

/**
 * Splits `total` into parts proportional to `weights` so that the parts sum
 * exactly to `total` (largest remainder method). Used for spreading an order
 * discount or a partial refund across lines without losing a single Rial.
 */
export function allocate(total: Rial, weights: readonly bigint[]): Rial[] {
  if (weights.length === 0) throw new MoneyError("allocate needs at least one weight");
  if (weights.some((w) => w < 0n)) throw new MoneyError("Weights must not be negative");
  const weightSum = weights.reduce((a, w) => a + w, 0n);
  if (weightSum === 0n) throw new MoneyError("Weights must not all be zero");

  const negative = total < 0n;
  const t = negative ? -total : total;
  const parts = weights.map((w) => (t * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (t * w) % weightSum }));
  let leftover = t - parts.reduce((a, p) => a + p, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return negative ? parts.map((p) => -p) : parts;
}

/** Exact Rial to Toman split: whole Toman plus the Rial remainder (0-9). */
export function toToman(amount: Rial): { whole: bigint; remainderRial: bigint } {
  return { whole: amount / RIAL_PER_TOMAN, remainderRial: amount % RIAL_PER_TOMAN };
}

/**
 * Toman to Rial. Accepts a bigint of whole Toman, or a decimal string with at
 * most one fractional digit ("1234.5" Toman = 12345 Rial). Anything that
 * cannot be represented exactly in Rial is rejected, never rounded silently.
 */
export function fromToman(toman: bigint | string): Rial {
  if (typeof toman === "bigint") return toman * RIAL_PER_TOMAN;
  const text = toman.trim();
  const match = /^(-?)(\d+)(?:\.(\d))?$/.exec(text);
  if (!match) {
    throw new MoneyError(`Toman amount must have at most one decimal digit, got "${toman}"`);
  }
  const [, sign, whole, fraction] = match;
  const value = BigInt(whole ?? "0") * RIAL_PER_TOMAN + BigInt(fraction ?? "0");
  return sign === "-" ? -value : value;
}

/**
 * Parses money typed by a person (admin forms, imports) in the given unit.
 * Accepts Persian, Arabic-Indic and ASCII digits, and the separators
 * `,` `٬` and spaces. Decimal separator `.` or `٫` (Toman only, one digit).
 */
export function parseMoneyInput(input: string, unit: DisplayUnit): Rial {
  const cleaned = toEnDigits(input)
    .replace(/[,٬\s‌]/g, "")
    .replace(/٫/g, ".")
    .replace(/[−]/g, "-");
  if (cleaned === "" || cleaned === "-") throw new MoneyError("Empty amount");
  return unit === "toman" ? fromToman(cleaned) : rial(cleaned);
}

export interface FormatMoneyOptions {
  /** Language of the label and default digit set. */
  locale: MoneyLocale;
  /** Display unit. Comes from the store setting `display_currency_unit`. */
  unit: DisplayUnit;
  /** Digit set; defaults to Persian digits for fa and ASCII for en. */
  digits?: DigitSet;
  /** Append the currency label (default true). */
  label?: boolean;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a Rial amount for display.
 * fa: "۱۲٬۳۴۵ تومان", en: "12,345 Toman".
 * When the unit is Toman and the amount is not a whole number of Toman, the
 * exact value is shown with one decimal ("۱٬۲۳۴٫۵ تومان"); no Rial is dropped.
 */
export function formatMoney(amount: Rial, options: FormatMoneyOptions): string {
  const { locale, unit, label = true } = options;
  const digits = options.digits ?? (locale === "fa" ? "fa" : "en");

  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;

  let integerPart: bigint;
  let fraction = "";
  if (unit === "toman") {
    const { whole, remainderRial } = toToman(absolute);
    integerPart = whole;
    if (remainderRial !== 0n) fraction = remainderRial.toString();
  } else {
    integerPart = absolute;
  }

  let text = groupThousands(integerPart.toString()) + (fraction ? `.${fraction}` : "");
  if (digits === "fa") {
    text = toFaDigits(text).replace(/,/g, "٬").replace(/\./g, "٫");
  }
  if (negative) text = `-${text}`;
  return label ? `${text} ${CURRENCY_LABELS[locale][unit]}` : text;
}

/** Serializes a Rial amount for JSON payloads (bigint is not JSON-safe). */
export function rialToJSON(amount: Rial): string {
  return amount.toString();
}

function assertSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${name} must be a safe integer, got ${value}`);
  return value;
}
