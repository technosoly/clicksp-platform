"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";

export type HeroSlide = {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  alt: string;
  lang: "fa" | "en";
  href: { kind: "internal"; path: string } | { kind: "external"; url: string } | null;
  desktop: { src: string; srcSet: string; width: number; height: number };
  mobile: { srcSet: string } | null;
};

const INTERVAL = 6000;

/**
 * The home page banners: one slide per screen width, swiped natively
 * (CSS scroll snap, works without JavaScript), with arrows and dots. Slides
 * advance every few seconds unless the visitor prefers reduced motion, or
 * is pointing at, focusing or has touched the slider. Only the first
 * picture loads eagerly.
 */
export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const t = useTranslations("Home.slider");
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);

  const go = useCallback((index: number) => {
    const root = track.current;
    const el = root?.children[(index + slides.length) % slides.length] as HTMLElement | undefined;
    if (!root || !el) return;
    // Scroll the track only (scrollIntoView would also move the page); the offset works in both directions.
    root.scrollBy({ left: el.getBoundingClientRect().left - root.getBoundingClientRect().left, behavior: "smooth" });
  }, [slides.length]);

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
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || paused || stopped) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => go(active + 1), INTERVAL);
    return () => window.clearTimeout(timer);
  }, [active, paused, stopped, go, slides.length]);

  if (slides.length === 0) return null;
  return (
    <section
      className="relative"
      aria-roledescription="carousel"
      aria-label={t("label")}
      data-testid="home-slider"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setStopped(true)}
    >
      <div ref={track} className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((s, i) => (
          <div key={s.id} data-index={i} className="relative w-full shrink-0 snap-start" role="group" aria-roledescription="slide" aria-label={t("position", { n: i + 1, total: slides.length })} data-testid="home-slide">
            <Slide slide={s} first={i === 0} />
          </div>
        ))}
      </div>
      {slides.length > 1 ? (
        <>
          <button type="button" onClick={() => { setStopped(true); go(active - 1); }} aria-label={t("previous")} className="absolute start-2 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-xl shadow md:flex">
            <span aria-hidden className="rtl:rotate-180">‹</span>
          </button>
          <button type="button" onClick={() => { setStopped(true); go(active + 1); }} aria-label={t("next")} className="absolute end-2 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-xl shadow md:flex">
            <span aria-hidden className="rtl:rotate-180">›</span>
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setStopped(true); go(i); }}
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === active ? "true" : undefined}
                className={cn("h-2.5 rounded-full bg-white/70 transition-all", i === active ? "w-6 bg-white" : "w-2.5")}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Slide({ slide, first }: { slide: HeroSlide; first: boolean }) {
  const picture = (
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
        className="aspect-[4/3] w-full object-cover sm:aspect-[21/9] lg:aspect-[3/1]"
      />
    </picture>
  );
  const text = (
    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-black/20 to-transparent">
      <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pb-8 text-white sm:pb-10" lang={slide.lang}>
        <p className="text-2xl font-extrabold leading-tight drop-shadow sm:text-4xl">{slide.title}</p>
        {slide.subtitle ? <p className="max-w-xl text-sm text-white/90 sm:text-lg">{slide.subtitle}</p> : null}
        {slide.ctaLabel ? <span className="inline-flex min-h-11 items-center rounded-md bg-brand-orange-strong px-5 font-semibold text-white">{slide.ctaLabel}</span> : null}
      </div>
    </div>
  );
  const body = (
    <>
      {picture}
      {text}
    </>
  );
  if (!slide.href) return body;
  if (slide.href.kind === "external") {
    return (
      <a href={slide.href.url} rel="noopener noreferrer" target="_blank" className="block">
        {body}
      </a>
    );
  }
  return (
    <Link href={slide.href.path} className="block">
      {body}
    </Link>
  );
}
