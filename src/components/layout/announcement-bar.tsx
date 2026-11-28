import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import type { SiteWording } from "./site-wording";

const TONE = {
  orange: "bg-brand-orange-strong text-white",
  charcoal: "bg-brand-charcoal text-brand-offwhite",
  light: "bg-accent text-foreground",
} as const;

/** The owner's one-line notice above the header (Site settings). Plain text; the link is a store path or an https address. */
export function AnnouncementBar({ announcement }: { announcement: NonNullable<SiteWording["announcement"]> }) {
  const body = (
    <span lang={announcement.lang} className="line-clamp-2">
      {announcement.text}
    </span>
  );
  const link = "underline-offset-4 hover:underline";
  return (
    <div className={cn("px-4 py-2 text-center text-sm font-medium", TONE[announcement.tone])} data-testid="announcement-bar">
      {announcement.href?.kind === "internal" ? (
        <Link href={announcement.href.path} className={link}>
          {body}
        </Link>
      ) : announcement.href?.kind === "external" ? (
        <a href={announcement.href.url} rel="noopener noreferrer" target="_blank" className={link}>
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}
