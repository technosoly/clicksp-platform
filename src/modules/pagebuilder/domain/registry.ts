import { z } from "zod";
import { Block, bodyText, parseBody } from "@/modules/content/domain/info-page";
import { normalizeForStorage } from "@/lib/persian-text";
import { hrefText, parseHref } from "@/modules/content/domain/links";

/**
 * The page builder's component registry: every section type a page may hold,
 * its props schema (Zod) and the fields its editor form shows. A document
 * can only name these types and only fill these props: there is no HTML,
 * script, style, class name or free URL anywhere. Colours are a token enum;
 * links are store paths or https addresses (content/domain/links.ts).
 * Renderers live in src/components/builder (Server Components).
 */

const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
const clean = (s: string) => normalizeForStorage(s.replace(UNSAFE, "")).replace(/[ \t]+/g, " ").trim();

const safe = (v: string) => !new RegExp(UNSAFE.source).test(v);
const text = (max: number) => z.string().min(1).max(max).refine(safe, "unsafe_character");
/** Text in Persian with optional English. */
const Localized = (max: number) => z.object({ fa: text(max), en: text(max).optional() }).strict();
const OptionalLocalized = (max: number) => z.object({ fa: text(max).optional(), en: text(max).optional() }).strict();
const SafeHref = z
  .string()
  .max(500)
  .refine((v) => safe(v) && parseHref(v) !== null, "invalid_link");
export const TONES = ["charcoal", "orange", "light"] as const;
const Tone = z.enum(TONES);
const Blocks = z
  .array(Block)
  .min(1)
  .max(200)
  .refine((blocks) => blocks.every((b) => ("text" in b ? [b.text] : b.items).every(safe)), "unsafe_character");

export const SECTION_PROPS = {
  bannerSlider: z.object({}).strict(),
  hero: z
    .object({ title: OptionalLocalized(120), subtitle: OptionalLocalized(300), showLogo: z.boolean(), showSearch: z.boolean(), tone: Tone })
    .strict(),
  motorcycles: z.object({ heading: OptionalLocalized(80), limit: z.number().int().min(6).max(48) }).strict(),
  categories: z.object({ heading: OptionalLocalized(80), limit: z.number().int().min(3).max(24) }).strict(),
  latestProducts: z.object({ heading: OptionalLocalized(80), limit: z.number().int().min(4).max(24) }).strict(),
  latestArticles: z.object({ heading: OptionalLocalized(80), limit: z.number().int().min(2).max(9) }).strict(),
  richText: z.object({ content: z.object({ fa: Blocks, en: Blocks.optional() }).strict() }).strict(),
  callout: z
    .object({ title: Localized(120), text: OptionalLocalized(400), href: SafeHref.optional(), cta: OptionalLocalized(40), tone: Tone })
    .strict(),
} as const;

export type SectionType = keyof typeof SECTION_PROPS;
export const SECTION_TYPES = Object.keys(SECTION_PROPS) as SectionType[];
export const isSectionType = (t: string): t is SectionType => (SECTION_TYPES as string[]).includes(t);
export type SectionProps<T extends SectionType> = z.infer<(typeof SECTION_PROPS)[T]>;

export const BREAKPOINTS = ["mobile", "tablet", "desktop"] as const;
export const Visibility = z
  .object({ breakpoints: z.array(z.enum(BREAKPOINTS)).min(1).max(3), locales: z.array(z.enum(["fa", "en"])).min(1).max(2) })
  .strict();
export type Visibility = z.infer<typeof Visibility>;
export const ALL_VISIBLE: Visibility = { breakpoints: ["mobile", "tablet", "desktop"], locales: ["fa", "en"] };

const SectionId = z.string().regex(/^[a-z0-9]{6,16}$/);
const section = <T extends SectionType>(type: T) => z.object({ id: SectionId, type: z.literal(type), visibility: Visibility, props: SECTION_PROPS[type] }).strict();
const Section = z.discriminatedUnion("type", [
  section("bannerSlider"),
  section("hero"),
  section("motorcycles"),
  section("categories"),
  section("latestProducts"),
  section("latestArticles"),
  section("richText"),
  section("callout"),
]);

export const DOCUMENT_LIMITS = { sections: 30, bytes: 128 * 1024 } as const;

export const BuilderDocument = z
  .object({ version: z.literal(1), sections: z.array(Section).max(DOCUMENT_LIMITS.sections) })
  .strict()
  .refine((d) => new Set(d.sections.map((x) => x.id)).size === d.sections.length, "duplicate_id")
  .refine((d) => JSON.stringify(d).length <= DOCUMENT_LIMITS.bytes, "too_large");

export type BuilderSection = { [T in SectionType]: { id: string; type: T; visibility: Visibility; props: SectionProps<T> } }[SectionType];
export type BuilderDocument = { version: 1; sections: BuilderSection[] };

/** Checks a stored or edited document; null when anything is off (it's then never rendered). */
export function readDocument(input: unknown): BuilderDocument | null {
  const parsed = BuilderDocument.safeParse(input);
  return parsed.success ? (parsed.data as BuilderDocument) : null;
}

/** New props for a section type, as the editor adds it. */
export function defaultProps<T extends SectionType>(type: T): SectionProps<T> {
  const defaults: { [K in SectionType]: SectionProps<K> } = {
    bannerSlider: {},
    hero: { title: {}, subtitle: {}, showLogo: true, showSearch: true, tone: "charcoal" },
    motorcycles: { heading: {}, limit: 12 },
    categories: { heading: {}, limit: 12 },
    latestProducts: { heading: {}, limit: 8 },
    latestArticles: { heading: {}, limit: 3 },
    richText: { content: { fa: [{ type: "paragraph", text: "…" }] } },
    callout: { title: { fa: "…" }, text: {}, cta: {}, tone: "orange" },
  };
  return defaults[type] as SectionProps<T>;
}

/** The home page as it looks before anything is published in the builder. */
export const DEFAULT_HOME: BuilderDocument = {
  version: 1,
  sections: [
    { id: "slider01", type: "bannerSlider", visibility: ALL_VISIBLE, props: {} },
    { id: "hero0001", type: "hero", visibility: ALL_VISIBLE, props: defaultProps("hero") },
    { id: "bikes001", type: "motorcycles", visibility: ALL_VISIBLE, props: defaultProps("motorcycles") },
    { id: "cats0001", type: "categories", visibility: ALL_VISIBLE, props: defaultProps("categories") },
    { id: "latest01", type: "latestProducts", visibility: ALL_VISIBLE, props: defaultProps("latestProducts") },
  ],
};

// Editor forms ---------------------------------------------------------------------------------

/** Fields the editor shows for a type; the form names are `<field>` or `<field>.fa` / `<field>.en`. */
export type FieldSpec =
  | { name: string; kind: "localized"; max: number; required?: boolean; multiline?: boolean }
  | { name: string; kind: "blocks" }
  | { name: string; kind: "boolean" }
  | { name: string; kind: "number"; min: number; max: number }
  | { name: string; kind: "tone" }
  | { name: string; kind: "href" };

export const FIELDS: Record<SectionType, FieldSpec[]> = {
  bannerSlider: [],
  hero: [
    { name: "title", kind: "localized", max: 120 },
    { name: "subtitle", kind: "localized", max: 300, multiline: true },
    { name: "showLogo", kind: "boolean" },
    { name: "showSearch", kind: "boolean" },
    { name: "tone", kind: "tone" },
  ],
  motorcycles: [
    { name: "heading", kind: "localized", max: 80 },
    { name: "limit", kind: "number", min: 6, max: 48 },
  ],
  categories: [
    { name: "heading", kind: "localized", max: 80 },
    { name: "limit", kind: "number", min: 3, max: 24 },
  ],
  latestProducts: [
    { name: "heading", kind: "localized", max: 80 },
    { name: "limit", kind: "number", min: 4, max: 24 },
  ],
  latestArticles: [
    { name: "heading", kind: "localized", max: 80 },
    { name: "limit", kind: "number", min: 2, max: 9 },
  ],
  richText: [{ name: "content", kind: "blocks" }],
  callout: [
    { name: "title", kind: "localized", max: 120, required: true },
    { name: "text", kind: "localized", max: 400, multiline: true },
    { name: "cta", kind: "localized", max: 40 },
    { name: "href", kind: "href" },
    { name: "tone", kind: "tone" },
  ],
};

/** Form values for a section's props (strings), for the editor. */
export function formValues(section: BuilderSection): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const props = section.props as Record<string, unknown>;
  for (const f of FIELDS[section.type]) {
    const v = props[f.name];
    if (f.kind === "localized") {
      const l = (v ?? {}) as { fa?: string; en?: string };
      out[`${f.name}.fa`] = l.fa ?? "";
      out[`${f.name}.en`] = l.en ?? "";
    } else if (f.kind === "blocks") {
      const l = (v ?? {}) as { fa?: Block[]; en?: Block[] };
      out[`${f.name}.fa`] = bodyText(l.fa);
      out[`${f.name}.en`] = bodyText(l.en);
    } else if (f.kind === "boolean") out[f.name] = v === true;
    else out[f.name] = v === undefined ? "" : String(v);
  }
  return out;
}

/** Reads an editor form into props for a type; errors name the field. */
export function propsFromForm(type: SectionType, get: (name: string) => string, has: (name: string) => boolean): { props: unknown } | { field: string } {
  const props: Record<string, unknown> = {};
  for (const f of FIELDS[type]) {
    if (f.kind === "localized") {
      const fa = clean(get(`${f.name}.fa`));
      const en = clean(get(`${f.name}.en`));
      if (f.required && !fa) return { field: `${f.name}_required` };
      if (!fa && en) return { field: "persian_first" };
      if (fa.length > f.max || en.length > f.max) return { field: "text_too_long" };
      props[f.name] = { ...(fa ? { fa } : {}), ...(en ? { en } : {}) };
    } else if (f.kind === "blocks") {
      const fa = parseBody(get(`${f.name}.fa`));
      const en = parseBody(get(`${f.name}.en`));
      if ("error" in fa || "error" in en) return { field: "text_too_long" };
      if (fa.blocks.length === 0) return { field: `${f.name}_required` };
      props[f.name] = en.blocks.length ? { fa: fa.blocks, en: en.blocks } : { fa: fa.blocks };
    } else if (f.kind === "boolean") props[f.name] = has(f.name);
    else if (f.kind === "number") {
      const n = Number(get(f.name).trim());
      if (!Number.isInteger(n) || n < f.min || n > f.max) return { field: "invalid_number" };
      props[f.name] = n;
    } else if (f.kind === "tone") {
      const t = get(f.name);
      if (!(TONES as readonly string[]).includes(t)) return { field: "invalid" };
      props[f.name] = t;
    } else if (f.kind === "href") {
      const raw = get(f.name).trim();
      if (raw) {
        const parsed = parseHref(raw);
        if (!parsed) return { field: "invalid_link" };
        props[f.name] = hrefText(parsed);
      }
    }
  }
  if (type === "callout") {
    const p = props as { cta?: { fa?: string }; href?: string };
    if (p.cta?.fa && !p.href) return { field: "cta_needs_link" };
  }
  const checked = SECTION_PROPS[type].safeParse(props);
  return checked.success ? { props: checked.data } : { field: "invalid" };
}

/** Reads the visibility checkboxes; at least one of each. */
export function visibilityFromForm(has: (name: string) => boolean): Visibility | { field: string } {
  const breakpoints = BREAKPOINTS.filter((b) => has(`show.${b}`));
  const locales = (["fa", "en"] as const).filter((l) => has(`show.${l}`));
  if (breakpoints.length === 0 || locales.length === 0) return { field: "visibility_required" };
  return { breakpoints, locales };
}
