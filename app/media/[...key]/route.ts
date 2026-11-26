import { openPublicImage } from "@/modules/media/service/images";

/**
 * Public product and catalog images (re-encoded WebP renditions). Only keys of
 * images that are ready, public and not deleted are served. File names never
 * change (a new upload gets a new id), so responses are cached for a year.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const file = await openPublicImage(key.join("/"));
  if (!file) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
  return new Response(file.body, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": file.size.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
