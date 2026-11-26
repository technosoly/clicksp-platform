/**
 * Pure rules for uploaded images: which files are accepted (by their bytes,
 * never by the name or the browser's claimed type), size limits, and the
 * sizes generated for the storefront. No I/O.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Decoding limit (width × height), against decompression bombs. */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MIN_IMAGE_SIDE = 200;
/** Widths generated (never enlarged), as WebP. The largest is the stored "original". */
export const RENDITION_WIDTHS = [320, 640, 1200, 2000] as const;

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

export const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/** The image format from the file's first bytes, or null when it isn't one we accept. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  const at = (i: number) => bytes[i];
  const ascii = (from: number, text: string) => [...text].every((ch, i) => at(from + i) === ch.charCodeAt(0));
  if (bytes.length < 12) return null;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && ascii(1, "PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"))) return "avif";
  return null;
}

export type ImageProblem = "image_missing" | "image_too_large" | "image_type" | "image_too_small";

/** Checks done before decoding. */
export function precheckImage(bytes: Uint8Array): ImageProblem | null {
  if (bytes.length === 0) return "image_missing";
  if (bytes.length > MAX_IMAGE_BYTES) return "image_too_large";
  if (!detectImageFormat(bytes)) return "image_type";
  return null;
}

/** The widths to generate for an image of this width (at least one). */
export function renditionWidths(width: number): number[] {
  const widths: number[] = RENDITION_WIDTHS.filter((w) => w < width);
  const largest = Math.min(width, RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1]!);
  if (!widths.includes(largest)) widths.push(largest);
  return widths;
}

export interface Rendition {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

/** Storage keys look like img/2026/11/<uuid>/640.webp; anything else is refused. */
export const IMAGE_KEY_PATTERN = /^img\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{2,4}\.webp$/;

export function imageKey(mediaId: string, width: number, at: Date): string {
  const yyyy = at.getUTCFullYear().toString();
  const mm = (at.getUTCMonth() + 1).toString().padStart(2, "0");
  return `img/${yyyy}/${mm}/${mediaId}/${width}.webp`;
}

/** Public URL of a stored image (served by app/media/[...key]). */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** The rendition closest to (and not below, when possible) a wanted width. */
export function pickRendition(renditions: readonly Rendition[], wanted: number): Rendition | null {
  if (renditions.length === 0) return null;
  const sorted = [...renditions].sort((a, b) => a.width - b.width);
  return sorted.find((r) => r.width >= wanted) ?? sorted[sorted.length - 1]!;
}

/** srcset value for <img>. */
export function srcSet(renditions: readonly Rendition[]): string {
  return [...renditions]
    .sort((a, b) => a.width - b.width)
    .map((r) => `${mediaUrl(r.key)} ${r.width}w`)
    .join(", ");
}
