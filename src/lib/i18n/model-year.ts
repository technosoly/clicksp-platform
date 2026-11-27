import { toEnDigits } from "@/lib/persian-text";

/**
 * A model year typed by an admin. Iranian bikes are usually named by their
 * solar (Jalali) model year, so 1300–1499 is read as Jalali and stored as the
 * Gregorian year it starts in (+621). Storage is always Gregorian.
 */
export function parseModelYear(input: string): number | null | "invalid" {
  const v = toEnDigits(input).trim();
  if (v === "") return null;
  if (!/^\d{4}$/.test(v)) return "invalid";
  const n = Number(v);
  if (n >= 1300 && n <= 1499) return n + 621;
  if (n >= 1885 && n <= 2100) return n;
  return "invalid";
}

/** The Jalali (solar) year a Gregorian model year mostly falls in, for display. */
export function jalaliModelYear(gregorian: number): number {
  return gregorian - 621;
}
