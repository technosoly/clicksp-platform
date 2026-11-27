import type { Block } from "@/modules/content/domain/info-page";

/** Text blocks (headings, paragraphs, lists) rendered as elements: nothing in them can run or inject markup. */
export function RichBlocks({ blocks }: { blocks: readonly Block[] }) {
  return blocks.map((b, i) =>
    b.type === "heading" ? (
      <h2 key={i} className="pt-2 text-lg font-bold">
        {b.text}
      </h2>
    ) : b.type === "paragraph" ? (
      <p key={i} className="whitespace-pre-line">
        {b.text}
      </p>
    ) : (
      <ul key={i} className="list-disc space-y-1 ps-6">
        {b.items.map((item, j) => (
          <li key={j}>{item}</li>
        ))}
      </ul>
    ),
  );
}
