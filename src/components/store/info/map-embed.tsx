"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * The Google map loads only when the visitor asks for it: the page itself
 * never waits on a foreign service, so it stays usable when Google is
 * unreachable from Iran. `src` was checked on save to be a Google Maps
 * embed URL (www.google.com/maps/embed).
 */
export function MapEmbed({ src, title }: { src: string; title: string }) {
  const t = useTranslations("Contact");
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="absolute inset-x-0 bottom-0 m-3 rounded-lg bg-background/95 px-4 py-2.5 text-sm font-semibold shadow-md ring-1 ring-border hover:bg-background"
        data-testid="contact-map-load"
      >
        {t("showMap")}
      </button>
    );
  }
  return (
    <iframe
      src={src}
      title={title}
      className="absolute inset-0 size-full border-0"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      data-testid="contact-map-frame"
    />
  );
}
