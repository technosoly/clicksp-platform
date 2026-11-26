import { cn } from "@/lib/utils/cn";
import { mediaUrl, pickRendition, srcSet, type Rendition } from "@/modules/media/domain/image-rules";

/**
 * A catalog photo (product, category, brand) from its stored WebP sizes, or
 * a neutral placeholder while none has been uploaded. Lazy-loaded unless
 * `priority`; the browser picks the size from `sizes`.
 */
export function CatalogImage({
  renditions,
  alt,
  sizes,
  width = 640,
  priority = false,
  className,
  testId,
}: {
  renditions: readonly Rendition[];
  alt: string;
  sizes: string;
  /** Width used for the fallback src (and the aspect ratio hint). */
  width?: number;
  priority?: boolean;
  className?: string;
  testId?: string;
}) {
  const main = pickRendition(renditions, width);
  if (!main) return <ImagePlaceholder label={alt} className={className} testId={testId} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions; next/image optimization isn't needed
    <img
      src={mediaUrl(main.key)}
      srcSet={srcSet(renditions)}
      sizes={sizes}
      width={main.width}
      height={main.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={cn("h-auto w-full bg-muted object-contain", className)}
      data-testid={testId}
    />
  );
}

/** Neutral stand-in image (a box with a bolt), replaced once a real photo is uploaded. */
export function ImagePlaceholder({ label, className, testId }: { label: string; className?: string; testId?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label={label}
      className={cn("aspect-square h-auto w-full bg-muted text-muted-foreground", className)}
      data-testid={testId ? `${testId}-placeholder` : undefined}
    >
      <rect x="30" y="38" width="60" height="44" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M30 50h60" stroke="currentColor" strokeWidth="3" />
      <circle cx="60" cy="66" r="7" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M60 59v-3M60 76v-3M53 66h-3M70 66h-3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
