import { z } from "zod";
import { normalizeForStorage } from "@/lib/persian-text";

/**
 * The store's information pages (about, contact, terms...): a fixed set of
 * system pages, each kept as revisions of a page document. The document is
 * the page builder's v1 shape with one `richText` section, so the builder
 * (Phase 7) can open these pages later without a migration.
 *
 * Text is structured blocks (heading, paragraph, list), never HTML: the
 * storefront renders them as React elements, so nothing in a page can run.
 * Admins write a light plain-text format that the server parses:
 *   "## " starts a heading, "- " starts a list item, and a blank line
 *   separates paragraphs.
 */

export const INFO_PAGE_KEYS = ["about", "contact", "shipping", "returns", "terms", "privacy"] as const;
export type InfoPageKey = (typeof INFO_PAGE_KEYS)[number];
export const isInfoPageKey = (key: string): key is InfoPageKey => (INFO_PAGE_KEYS as readonly string[]).includes(key);

export const LIMITS = { title: 200, body: 20_000, heading: 200, paragraph: 5_000, item: 500, items: 50, blocks: 200 } as const;

const Block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1).max(LIMITS.heading) }),
  z.object({ type: z.literal("paragraph"), text: z.string().min(1).max(LIMITS.paragraph) }),
  z.object({ type: z.literal("list"), items: z.array(z.string().min(1).max(LIMITS.item)).min(1).max(LIMITS.items) }),
]);
export type Block = z.infer<typeof Block>;
const Blocks = z.array(Block).min(1).max(LIMITS.blocks);

export const InfoPageDocument = z.object({
  version: z.literal(1),
  sections: z
    .array(
      z.object({
        id: z.literal("body"),
        type: z.literal("richText"),
        visibility: z.object({
          breakpoints: z.array(z.enum(["mobile", "tablet", "desktop"])).min(1),
          locales: z.array(z.enum(["fa", "en"])).min(1),
        }),
        props: z.object({ content: z.object({ fa: Blocks, en: Blocks.optional() }) }),
      }),
    )
    .length(1),
});
export type InfoPageDocument = z.infer<typeof InfoPageDocument>;

// Control characters except tab and line feed; bidi overrides that could disguise text.
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
const clean = (s: string) => normalizeForStorage(s.replace(UNSAFE, ""));

/** Parses the admin's plain text into blocks; "" gives []. Errors name the limit that was broken. */
export function parseBody(input: string): { blocks: Block[] } | { error: "too_long" | "too_many_blocks" | "block_too_long" } {
  if (input.length > LIMITS.body) return { error: "too_long" };
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    if (list) blocks.push({ type: "list", items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = clean(raw);
    if (line === "") {
      flush();
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
      const text = clean(line.replace(/^#+/, ""));
      if (text) blocks.push({ type: "heading", text });
    } else if (/^[-*•]\s/.test(line)) {
      if (paragraph.length > 0) flush();
      const item = clean(line.slice(1));
      if (item) (list ??= []).push(item);
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  if (blocks.length > LIMITS.blocks) return { error: "too_many_blocks" };
  const checked = z.array(Block).safeParse(blocks);
  if (!checked.success) return { error: "block_too_long" };
  return { blocks: checked.data };
}

/** The blocks back as the plain text the editor shows. */
export function bodyText(blocks: readonly Block[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((b) => (b.type === "heading" ? `## ${b.text}` : b.type === "paragraph" ? b.text : b.items.map((i) => `- ${i}`).join("\n")))
    .join("\n\n");
}

export function infoPageDocument(fa: Block[], en: Block[] | null): InfoPageDocument {
  return {
    version: 1,
    sections: [
      {
        id: "body",
        type: "richText",
        visibility: { breakpoints: ["mobile", "tablet", "desktop"], locales: en ? ["fa", "en"] : ["fa"] },
        props: { content: en ? { fa, en } : { fa } },
      },
    ],
  };
}

export type InfoPageInput = { faTitle: string; faBody: string; enTitle: string; enBody: string };
export type InfoPageParsed = { titles: { fa: string; en: string | null }; document: InfoPageDocument };

/** Validates an edit: Persian title and text are required; English is both or neither. */
export function parseInfoPage(input: InfoPageInput): InfoPageParsed | { field: string } {
  const faTitle = clean(input.faTitle);
  const enTitle = clean(input.enTitle);
  if (!faTitle) return { field: "title_required" };
  if (faTitle.length > LIMITS.title || enTitle.length > LIMITS.title) return { field: "title_too_long" };
  const fa = parseBody(input.faBody);
  if ("error" in fa) return { field: `body_${fa.error}` };
  if (fa.blocks.length === 0) return { field: "body_required" };
  const en = parseBody(input.enBody);
  if ("error" in en) return { field: `body_${en.error}` };
  if (Boolean(enTitle) !== en.blocks.length > 0) return { field: "english_incomplete" };
  return { titles: { fa: faTitle, en: enTitle || null }, document: infoPageDocument(fa.blocks, enTitle ? en.blocks : null) };
}
