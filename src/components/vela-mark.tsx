/**
 * Vela logo mark — a sailboat: two sails on a mast above a hull.
 * "Vela" = sail (Latin/Italian) / candle (Spanish/Portuguese); the mark
 * commits to the sail reading (instantly recognizable) with a lit masthead
 * as a small nod to the candle/guiding-star meaning. currentColor so it
 * inherits the container's foreground on the brand-green tile.
 */
export function VelaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* masthead light — candle flame / guiding star */}
      <circle cx="12" cy="3.1" r="1.05" fill="currentColor" />
      {/* mainsail (aft) — billows to the right of the mast */}
      <path
        d="M12.7 4.6 C 16.8 7 18.7 11 19.1 15.1 L 12.7 15.1 Z"
        fill="currentColor"
      />
      {/* jib (fore) — smaller sail left of the mast */}
      <path
        d="M11.3 7.2 C 8.7 9.6 7.2 12.5 6.7 15.1 L 11.3 15.1 Z"
        fill="currentColor"
      />
      {/* hull */}
      <path
        d="M4 16.6 H20 C 19 19.9 15.8 21.4 12 21.4 C 8.2 21.4 5 19.9 4 16.6 Z"
        fill="currentColor"
      />
    </svg>
  );
}
