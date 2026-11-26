import { toEnDigits } from "@/lib/persian-text";

/**
 * Iranian mobile numbers to E.164 (+989XXXXXXXXX), the format stored in
 * users.phone_number. Accepts the ways people type them: 09121234567,
 * 9121234567, +98 912 123 4567, 0098912..., Persian or Arabic digits, spaces,
 * dashes and brackets. Returns null for anything that is not an Iranian
 * mobile number (landlines and foreign numbers are not used for OTP).
 */
export function normalizeIranianMobile(input: string): string | null {
  const digits = toEnDigits(input).replace(/[\s\-().‌‏‎]/g, "");
  let national: string;
  if (/^\+989\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^00989\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^989\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^9\d{9}$/.test(digits)) national = digits;
  else return null;
  return `+98${national}`;
}

/** Masks a phone number for display and logs: +98912***4567. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return "***";
  return `${e164.slice(0, 6)}***${e164.slice(-4)}`;
}
