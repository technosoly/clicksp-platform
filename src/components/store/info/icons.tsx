/** Small line icons for the About and Contact pages (inline SVG, no icon library). */
const paths = {
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21Zm0-8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  phone: "M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2L20 15.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2",
  mail: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Zm-3.5 9 2.5 2.5 4.5-5",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5-2.1-.7-.5-1.3 1-2-1.4-1.4-2 1-1.3-.5L13 4h-2l-.7 2.1-1.3.5-2-1L5.6 7l1 2-.5 1.3L4 11v2l2.1.7.5 1.3-1 2L7 18.4l2-1 1.3.5L11 20h2l.7-2.1 1.3-.5 2 1 1.4-1.4-1-2 .5-1.3L20 13v-2Z",
  truck: "M3 6.5h11v9H3zM14 9.5h3.5l3 3v3H14M7 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  headset: "M4.5 14v-2a7.5 7.5 0 0 1 15 0v2M4.5 14h2.5v5H5.5a1 1 0 0 1-1-1v-4Zm15 0H17v5h1.5a1 1 0 0 0 1-1v-4ZM17 19c0 1-1.5 2-4 2",
  map: "M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14",
  arrow: "M14 6l6 6-6 6M20 12H4",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
