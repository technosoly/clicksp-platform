import { z } from "zod";
import { normalizeForStorage, toEnDigits } from "@/lib/persian-text";

/**
 * The store's contact details for the Contact page (store setting
 * `store.contact`, edited by admins with settings.store). Nothing is seeded:
 * an empty value means "not set yet", and the page then says so instead of
 * showing invented details (CLAUDE.md: no fictional business data).
 *
 * Maps: the page never loads a third-party map by itself, so it works when
 * foreign services are unreachable from Iran. Admins paste the share links
 * they copy from Google Maps, Neshan and Balad; the page shows them as
 * buttons. A Google Maps "Embed a map" link, when given, loads only after
 * the visitor presses "show map".
 */

export const CONTACT_LIMITS = { address: 500, hours: 300, phone: 20, phones: 3, email: 254, url: 2_000 } as const;

// Control characters except tab and line feed; bidi overrides that could disguise text.
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
const clean = (s: string) => normalizeForStorage(s.replace(UNSAFE, ""));

/** Hosts each map link may point at. Shortened share links (maps.app.goo.gl, nshn.ir) are allowed. */
const MAP_HOSTS = {
  google: ["www.google.com", "google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl"],
  neshan: ["neshan.org", "www.neshan.org", "nshn.ir"],
  balad: ["balad.ir", "www.balad.ir"],
} as const;
export type MapProvider = keyof typeof MAP_HOSTS;
export const MAP_PROVIDERS = Object.keys(MAP_HOSTS) as MapProvider[];

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

export function isMapLink(provider: MapProvider, value: string): boolean {
  const url = httpsUrl(value);
  return Boolean(url && (MAP_HOSTS[provider] as readonly string[]).includes(url.hostname));
}

/** Only Google's own embed endpoint (the src of the iframe from "Share > Embed a map"). */
export function isGoogleEmbed(value: string): boolean {
  const url = httpsUrl(value);
  return Boolean(url && url.hostname === "www.google.com" && url.pathname === "/maps/embed" && url.searchParams.has("pb"));
}

/** Pulls the src out of a pasted `<iframe src="...">` snippet, or returns the text as it is. */
export function embedSrc(value: string): string {
  const match = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(value);
  return (match?.[1] ?? value).trim().replace(/&amp;/g, "&");
}

const Phone = z.string().regex(/^\+?[0-9]{4,15}$/);

export const ContactInfo = z.object({
  address: z.object({ fa: z.string().max(CONTACT_LIMITS.address), en: z.string().max(CONTACT_LIMITS.address) }),
  hours: z.object({ fa: z.string().max(CONTACT_LIMITS.hours), en: z.string().max(CONTACT_LIMITS.hours) }),
  phones: z.array(Phone).max(CONTACT_LIMITS.phones),
  email: z.union([z.literal(""), z.email().max(CONTACT_LIMITS.email)]),
  maps: z.object({
    google: z.string().max(CONTACT_LIMITS.url).refine((v) => v === "" || isMapLink("google", v)),
    neshan: z.string().max(CONTACT_LIMITS.url).refine((v) => v === "" || isMapLink("neshan", v)),
    balad: z.string().max(CONTACT_LIMITS.url).refine((v) => v === "" || isMapLink("balad", v)),
    googleEmbed: z.string().max(CONTACT_LIMITS.url).refine((v) => v === "" || isGoogleEmbed(v)),
  }),
});
export type ContactInfo = z.infer<typeof ContactInfo>;

export const EMPTY_CONTACT: ContactInfo = {
  address: { fa: "", en: "" },
  hours: { fa: "", en: "" },
  phones: [],
  email: "",
  maps: { google: "", neshan: "", balad: "", googleEmbed: "" },
};

/** A stored value, or the empty details when it is missing or no longer matches the schema. */
export function readContactInfo(value: unknown): ContactInfo {
  const parsed = ContactInfo.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_CONTACT;
}

export const hasContactDetails = (c: ContactInfo) => Boolean(c.address.fa || c.phones.length > 0 || c.email);

/** "021-1234 5678", "۰۹۱۲ ..." → "02112345678"; a leading + is kept. */
export function normalizePhone(input: string): string {
  const digits = toEnDigits(input).trim();
  return (digits.startsWith("+") ? "+" : "") + digits.replace(/[^0-9]/g, "");
}

export type ContactInput = {
  addressFa: string;
  addressEn: string;
  hoursFa: string;
  hoursEn: string;
  phones: string[];
  email: string;
  google: string;
  neshan: string;
  balad: string;
  googleEmbed: string;
};

/** Validates an admin edit. Errors name the field that was wrong. */
export function parseContactInput(input: ContactInput): { value: ContactInfo } | { field: string } {
  const text = (s: string) => clean(s).trim();
  const phones = input.phones.map(normalizePhone).filter((p) => p !== "");
  if (phones.length > CONTACT_LIMITS.phones) return { field: "phones_too_many" };
  if (phones.some((p) => !Phone.safeParse(p).success)) return { field: "phone_invalid" };
  const value = {
    address: { fa: text(input.addressFa), en: text(input.addressEn) },
    hours: { fa: text(input.hoursFa), en: text(input.hoursEn) },
    phones: [...new Set(phones)],
    email: input.email.trim().toLowerCase(),
    maps: { google: input.google.trim(), neshan: input.neshan.trim(), balad: input.balad.trim(), googleEmbed: embedSrc(input.googleEmbed) },
  };
  if (value.address.fa.length > CONTACT_LIMITS.address || value.address.en.length > CONTACT_LIMITS.address) return { field: "address_too_long" };
  if (value.hours.fa.length > CONTACT_LIMITS.hours || value.hours.en.length > CONTACT_LIMITS.hours) return { field: "hours_too_long" };
  if (value.address.en && !value.address.fa) return { field: "address_fa_required" };
  const parsed = ContactInfo.safeParse(value);
  if (parsed.success) return { value: parsed.data };
  const path = parsed.error.issues[0]?.path ?? [];
  return { field: path[0] === "email" ? "email_invalid" : path[0] === "maps" ? `map_${String(path[1])}_invalid` : "invalid" };
}

/** tel: link target: digits only, with the + kept. */
export const telHref = (phone: string) => `tel:${phone}`;
