/**
 * Iran's 31 provinces, keyed by their ISO 3166-2:IR codes. Reference data
 * (not business data): addresses and shipping zones store the code, and
 * names are shown from here in the visitor's language.
 */
export const PROVINCES = [
  { code: "IR-23", fa: "تهران", en: "Tehran" },
  { code: "IR-30", fa: "البرز", en: "Alborz" },
  { code: "IR-10", fa: "اصفهان", en: "Isfahan" },
  { code: "IR-09", fa: "خراسان رضوی", en: "Razavi Khorasan" },
  { code: "IR-07", fa: "فارس", en: "Fars" },
  { code: "IR-03", fa: "آذربایجان شرقی", en: "East Azerbaijan" },
  { code: "IR-04", fa: "آذربایجان غربی", en: "West Azerbaijan" },
  { code: "IR-24", fa: "اردبیل", en: "Ardabil" },
  { code: "IR-16", fa: "ایلام", en: "Ilam" },
  { code: "IR-18", fa: "بوشهر", en: "Bushehr" },
  { code: "IR-14", fa: "چهارمحال و بختیاری", en: "Chaharmahal and Bakhtiari" },
  { code: "IR-29", fa: "خراسان جنوبی", en: "South Khorasan" },
  { code: "IR-28", fa: "خراسان شمالی", en: "North Khorasan" },
  { code: "IR-06", fa: "خوزستان", en: "Khuzestan" },
  { code: "IR-19", fa: "زنجان", en: "Zanjan" },
  { code: "IR-20", fa: "سمنان", en: "Semnan" },
  { code: "IR-11", fa: "سیستان و بلوچستان", en: "Sistan and Baluchestan" },
  { code: "IR-26", fa: "قزوین", en: "Qazvin" },
  { code: "IR-25", fa: "قم", en: "Qom" },
  { code: "IR-12", fa: "کردستان", en: "Kurdistan" },
  { code: "IR-08", fa: "کرمان", en: "Kerman" },
  { code: "IR-05", fa: "کرمانشاه", en: "Kermanshah" },
  { code: "IR-17", fa: "کهگیلویه و بویراحمد", en: "Kohgiluyeh and Boyer-Ahmad" },
  { code: "IR-27", fa: "گلستان", en: "Golestan" },
  { code: "IR-01", fa: "گیلان", en: "Gilan" },
  { code: "IR-15", fa: "لرستان", en: "Lorestan" },
  { code: "IR-02", fa: "مازندران", en: "Mazandaran" },
  { code: "IR-00", fa: "مرکزی", en: "Markazi" },
  { code: "IR-22", fa: "هرمزگان", en: "Hormozgan" },
  { code: "IR-13", fa: "همدان", en: "Hamadan" },
  { code: "IR-21", fa: "یزد", en: "Yazd" },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]["code"];

const BY_CODE = new Map<string, (typeof PROVINCES)[number]>(PROVINCES.map((p) => [p.code, p]));

export function isProvinceCode(code: unknown): code is ProvinceCode {
  return typeof code === "string" && BY_CODE.has(code);
}

export function provinceName(code: string, locale: "fa" | "en"): string {
  return BY_CODE.get(code)?.[locale] ?? code;
}
