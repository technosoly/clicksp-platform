import { z } from "zod";
import { normalizeForSearch, normalizeForStorage } from "@/lib/persian-text";
import { SLUG_PATTERN, slugify } from "@/lib/i18n/names";
import { Block, parseBody } from "./info-page";

/**
 * Articles (the store's blog): a Persian title, address (slug), summary and
 * text, and optionally the same in English. The text uses the information
 * pages' plain-text format and is stored as structured blocks, never HTML.
 */

export const ARTICLE_LIMITS = { title: 250, slug: 150, excerpt: 1000 } as const;
export const ARTICLE_STATUSES = ["draft", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ArticleBody = z.object({ version: z.literal(1), blocks: z.array(Block).min(1) });
export type ArticleBody = z.infer<typeof ArticleBody>;

export type ArticleInput = {
  status: string;
  faTitle: string;
  faSlug: string;
  faExcerpt: string;
  faBody: string;
  enTitle: string;
  enSlug: string;
  enExcerpt: string;
  enBody: string;
};

export type ArticleLanguage = { title: string; slug: string; excerpt: string | null; body: ArticleBody; searchTitle: string };
export type ArticleParsed = { status: ArticleStatus; fa: ArticleLanguage; en: ArticleLanguage | null };

// Control characters except tab and line feed; bidi overrides that could disguise text.
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
const line = (s: string) => normalizeForStorage(s.replace(UNSAFE, "")).replace(/\s+/g, " ").trim();

function language(lang: "fa" | "en", title: string, slugInput: string, excerptInput: string, bodyInput: string): ArticleLanguage | { field: string } {
  const t = line(title);
  if (!t) return { field: `${lang}_title_required` };
  if (t.length > ARTICLE_LIMITS.title) return { field: "title_too_long" };
  const slug = slugify(slugInput.trim() ? slugInput : t);
  if (!slug || slug.length > ARTICLE_LIMITS.slug || !SLUG_PATTERN.test(slug)) return { field: `${lang}_slug_invalid` };
  const excerpt = line(excerptInput);
  if (excerpt.length > ARTICLE_LIMITS.excerpt) return { field: "excerpt_too_long" };
  const body = parseBody(bodyInput);
  if ("error" in body) return { field: `body_${body.error}` };
  if (body.blocks.length === 0) return { field: `${lang}_body_required` };
  return { title: t, slug, excerpt: excerpt || null, body: { version: 1, blocks: body.blocks }, searchTitle: normalizeForSearch(t).slice(0, 500) };
}

/** Validates an article: Persian is required; English is all of title and text, or nothing. */
export function parseArticle(input: ArticleInput): ArticleParsed | { field: string } {
  const status = ARTICLE_STATUSES.find((s) => s === input.status);
  if (!status) return { field: "invalid_status" };
  const fa = language("fa", input.faTitle, input.faSlug, input.faExcerpt, input.faBody);
  if ("field" in fa) return fa;
  const anyEnglish = [input.enTitle, input.enSlug, input.enExcerpt, input.enBody].some((v) => v.trim() !== "");
  if (!anyEnglish) return { status, fa, en: null };
  if (!input.enTitle.trim() || !input.enBody.trim()) return { field: "english_incomplete" };
  const en = language("en", input.enTitle, input.enSlug, input.enExcerpt, input.enBody);
  if ("field" in en) return en;
  return { status, fa, en };
}
