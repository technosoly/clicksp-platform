import { CatalogImage } from "@/components/media/catalog-image";
import { Link } from "@/lib/i18n/navigation";
import type { Rendition } from "@/modules/media/domain/image-rules";

/** A category tile: picture (or placeholder) and name. */
export function CategoryTile({ name, href, renditions, testId = "category-tile" }: { name: string; href: string; renditions: Rendition[]; testId?: string }) {
  return (
    <li>
      <Link href={href} className="flex h-full flex-col overflow-hidden rounded-lg border bg-card text-center hover:border-brand-orange" data-testid={testId}>
        <CatalogImage renditions={renditions} alt={name} sizes="(min-width: 1024px) 180px, 33vw" width={320} className="aspect-[4/3] object-cover" />
        <span className="p-2 text-sm font-semibold">{name}</span>
      </Link>
    </li>
  );
}
