"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";

type SlideHref = { kind: "internal"; path: string } | { kind: "external"; url: string } | null;

type SlideText = {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  lang: "fa" | "en";
  href: SlideHref;
};

/** A banner from the admin panel: a picture with optional text over it. */
export type HeroImageSlide = SlideText & {
  kind: "image";
  alt: string;
  desktop: { src: string; srcSet: string; width: number; height: number };
  mobile: { srcSet: string } | null;
};

/** A built-in slide drawn in the brand colours, shown while no banner is live. */
export type HeroBrandSlide = SlideText & {
  kind: "brand";
  tone: "charcoal" | "orange" | "light";
  eyebrow: string | null;
};

export type HeroSlide = HeroImageSlide | HeroBrandSlide;

const INTERVAL = 6000;

// Every slide has the same box at every width, so nothing moves while pictures load.
const FRAME = "aspect-[4/3] w-full sm:aspect-[21/9] lg:aspect-[3/1]";

/**
 * The home page header slider: one slide per screen width, swiped natively
 * (CSS scroll snap, works without JavaScript), with arrows, dots and a
 * pause button. Slides advance every few seconds unless the visitor prefers
 * reduced motion, pressed pause, or is pointing at, focusing or touching the
 * slider. Arrows wrap around. Only the first picture loads eagerly.
 */
export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const t = useTranslations("Home.slider");
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState(false);
  const [touching, setTouching] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reduced, setReduced] = useState(false);
  const count = slides.length;

  const go = useCallback(
    (index: number, smooth = true) => {
      const root = track.current;
      const el = root?.children[(index + count) % count] as HTMLElement | undefined;
      if (!root || !el) return;
      // Scroll the track only (scrollIntoView would also move the page); the offset works in both directions.
      root.scrollBy({ left: el.getBoundingClientRect().left - root.getBoundingClientRect().left, behavior: smooth && !reduced ? "smooth" : "auto" });
    },
    [count, reduced],
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: 0.6 },
    );
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [count]);

  const playing = count > 1 && !stopped && !reduced && !hover && !touching;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => go(active + 1), INTERVAL);
    return () => window.clearTimeout(timer);
  }, [active, playing, go]);

  if (count === 0) return null;
  const arrow =
    "absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-brand-charcoal shadow-md transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:flex sm:size-11";
  return (
    <section
      className="relative bg-brand-charcoal"
      aria-roledescription="carousel"
      aria-label={t("label")}
      data-testid="home-slider"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setHover(true)}
      onBlurCapture={() => setHover(false)}
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
    >
      <div
        ref={track}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-live={playing ? "off" : "polite"}
      >
        {slides.map((s, i) => (
          <div
            key={s.id}
            data-index={i}
            className="relative w-full shrink-0 snap-start"
            role="group"
            aria-roledescription="slide"
            aria-label={t("position", { n: i + 1, total: count })}
            data-testid="home-slide"
            data-kind={s.kind}
          >
            <Slide slide={s} first={i === 0} />
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(active - 1)} aria-label={t("previous")} className={cn(arrow, "start-2 sm:start-4")} data-testid="home-slider-previous">
            <Chevron className="rtl:rotate-180" back />
          </button>
          <button type="button" onClick={() => go(active + 1)} aria-label={t("next")} className={cn(arrow, "end-2 sm:end-4")} data-testid="home-slider-next">
            <Chevron className="rtl:rotate-180" />
          </button>
          <div className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-1 sm:bottom-3">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === active ? "true" : undefined}
                data-testid="home-slider-dot"
                className="flex h-8 items-center px-1"
              >
                <span className={cn("relative block h-1.5 overflow-hidden rounded-full bg-white/50 transition-all", i === active ? "w-8 sm:w-10" : "w-4")}>
                  {i === active ? (
                    <span
                      key={`${active}-${playing}`}
                      className={cn("absolute inset-y-0 start-0 block bg-white", playing ? "w-0 animate-[hero-progress_linear_forwards]" : "w-full")}
                      style={playing ? { animationDuration: `${INTERVAL}ms` } : undefined}
                    />
                  ) : null}
                </span>
              </button>
            ))}
            {!reduced ? (
              <button
                type="button"
                onClick={() => setStopped((v) => !v)}
                aria-label={stopped ? t("play") : t("pause")}
                aria-pressed={stopped}
                data-testid="home-slider-pause"
                className="ms-1 flex size-8 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55"
              >
                {stopped ? <PlayIcon /> : <PauseIcon />}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Chevron({ className, back }: { className?: string; back?: boolean }) {
  // Drawn pointing left (back) or right (forward) for LTR; mirrored in RTL.
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-5", className)} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={back ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-3.5" fill="currentColor">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 rtl:-scale-x-100" fill="currentColor">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
  </svg>
);

const BRAND_TONE = {
  charcoal: { box: "bg-brand-charcoal text-brand-offwhite", accent: "text-brand-orange/35", cta: "bg-brand-orange-strong text-white" },
  orange: { box: "bg-brand-orange-strong text-white", accent: "text-white/15", cta: "bg-brand-charcoal text-white" },
  light: { box: "bg-brand-silver text-brand-charcoal", accent: "text-brand-orange/25", cta: "bg-brand-orange-strong text-white" },
} as const;

function SlideCopy({ slide, overlay, eyebrow, ctaClass }: { slide: SlideText; overlay: boolean; eyebrow?: string | null; ctaClass: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-2 px-5 sm:space-y-3 sm:px-20", overlay ? "pb-12 text-white sm:pb-14" : "")} lang={slide.lang}>
      {eyebrow ? <p className="text-xs font-bold tracking-wide opacity-80 sm:text-sm">{eyebrow}</p> : null}
      <p className={cn("max-w-2xl text-2xl font-extrabold leading-tight sm:text-4xl lg:text-5xl", overlay && "drop-shadow")}>{slide.title}</p>
      {slide.subtitle ? <p className="line-clamp-3 max-w-xl text-sm opacity-90 sm:text-lg">{slide.subtitle}</p> : null}
      {slide.ctaLabel ? (
        <span className={cn("mt-1 inline-flex min-h-11 items-center gap-2 rounded-md px-5 text-sm font-bold shadow sm:text-base", ctaClass)}>
          {slide.ctaLabel}
          <Chevron className="size-4 rtl:rotate-180" />
        </span>
      ) : null}
    </div>
  );
}

function Slide({ slide, first }: { slide: HeroSlide; first: boolean }) {
  const body =
    slide.kind === "image" ? (
      <div className={cn("relative", FRAME)}>
        <picture>
          {slide.mobile ? <source media="(max-width: 767px)" srcSet={slide.mobile.srcSet} sizes="100vw" /> : null}
          <img
            src={slide.desktop.src}
            srcSet={slide.desktop.srcSet}
            sizes="100vw"
            width={slide.desktop.width}
            height={slide.desktop.height}
            alt={slide.alt}
            lang={slide.lang}
            loading={first ? "eager" : "lazy"}
            fetchPriority={first ? "high" : undefined}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-black/15 to-transparent">
          <SlideCopy slide={slide} overlay ctaClass="bg-brand-orange-strong text-white" />
        </div>
      </div>
    ) : (
      <div className={cn("relative flex items-center overflow-hidden", FRAME, BRAND_TONE[slide.tone].box)}>
        <BrandArt className={BRAND_TONE[slide.tone].accent} />
        <div className="relative w-full pb-6">
          <SlideCopy slide={slide} overlay={false} eyebrow={slide.eyebrow} ctaClass={BRAND_TONE[slide.tone].cta} />
        </div>
      </div>
    );
  if (!slide.href) return body;
  if (slide.href.kind === "external") {
    return (
      <a href={slide.href.url} rel="noopener noreferrer" target="_blank" className="block" draggable={false}>
        {body}
      </a>
    );
  }
  return (
    <Link href={slide.href.path} className="block" draggable={false}>
      {body}
    </Link>
  );
}

// Six wheel spokes, rounded so the server and the browser draw the same numbers.
const SPOKES = Array.from({ length: 6 }, (_, i) => {
  const a = (i * Math.PI) / 3;
  return [52, 150].flatMap((r) => [Math.round(200 + r * Math.cos(a)), Math.round(200 + r * Math.sin(a))]);
});

/** Decorative wheel and disc shapes at the slide's end side (no picture to download). */
function BrandArt({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 400 400" aria-hidden className={cn("pointer-events-none absolute -end-16 top-1/2 h-[140%] -translate-y-1/2 sm:-end-8 sm:h-[130%]", className)} fill="none" stroke="currentColor">
      <circle cx="200" cy="200" r="170" strokeWidth="26" />
      <circle cx="200" cy="200" r="118" strokeWidth="6" strokeDasharray="22 14" />
      <circle cx="200" cy="200" r="38" strokeWidth="18" />
      {SPOKES.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="14" strokeLinecap="round" />
      ))}
    </svg>
  );
}
