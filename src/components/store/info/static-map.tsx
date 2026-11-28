/** A drawn street map with a pin: shown in place of a live map, so nothing loads from another site. */
export function StaticMap() {
  return (
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true">
      <rect width="400" height="260" fill="#ebe8e1" />
      <path d="M0 70h400M0 170h400M120 0v260M280 0v260" stroke="#fff" strokeWidth="14" />
      <path d="M0 120h400M60 0v260M200 0v260M340 0v260M0 220h400" stroke="#fff" strokeWidth="6" />
      <path d="M-20 250 420 10" stroke="#f3d5c2" strokeWidth="18" />
      <rect x="140" y="88" width="44" height="66" rx="4" fill="#dcd9d2" />
      <rect x="216" y="184" width="50" height="28" rx="4" fill="#dcd9d2" />
      <rect x="296" y="88" width="30" height="26" rx="4" fill="#cfe3d2" />
      <rect x="72" y="184" width="36" height="28" rx="4" fill="#cfe3d2" />
      <circle cx="200" cy="120" r="34" fill="#c65a19" opacity=".15" />
      <path d="M200 140s-20-17.5-20-32a20 20 0 1 1 40 0c0 14.5-20 32-20 32Z" fill="#b85317" />
      <circle cx="200" cy="108" r="7" fill="#fff" />
    </svg>
  );
}
