import type { ReactNode } from "react";
import { Link } from "@/lib/i18n/navigation";
import type { ShopLink } from "@/modules/content/service/menus";

/** A link from an admin-edited menu: inside the store in the visitor's language, or an https address in a new tab. */
export function MenuLink({ link, className, children, testId }: { link: ShopLink; className?: string; children?: ReactNode; testId?: string }) {
  const body = children ?? link.label;
  if (link.href.kind === "external") {
    return (
      <a href={link.href.url} rel="noopener noreferrer" target="_blank" lang={link.lang} className={className} data-testid={testId}>
        {body}
      </a>
    );
  }
  return (
    <Link href={link.href.path} lang={link.lang} className={className} data-testid={testId}>
      {body}
    </Link>
  );
}
