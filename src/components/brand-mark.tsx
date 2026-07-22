/**
 * Nhật Ký Trade brand mark — an open journal (nhật ký) with a pair of
 * candlesticks rising from its pages. Pure line-art: every element is a
 * stroked outline (hollow candle bodies, no solid fill) so it reads like a
 * single pen drawing. The open book carries the journal meaning; the
 * candlesticks carry the trading meaning. currentColor so it inherits the
 * foreground on the brand-green tile.
 */
export function BrandMark({ className }: { className?: string }) {
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* left candle — hollow body + split wick */}
      <line x1="8.9" y1="5" x2="8.9" y2="7" {...stroke} />
      <rect x="7.15" y="7" width="3.5" height="4.8" rx="1.1" {...stroke} />
      <line x1="8.9" y1="11.8" x2="8.9" y2="12.8" {...stroke} />
      {/* right candle — hollow body + split wick */}
      <line x1="15.1" y1="3.8" x2="15.1" y2="5.8" {...stroke} />
      <rect x="13.35" y="5.8" width="3.5" height="5.4" rx="1.1" {...stroke} />
      <line x1="15.1" y1="11.2" x2="15.1" y2="12.6" {...stroke} />
      {/* open journal — softly bowed pages */}
      <path
        d="M12 15.6 C 9.3 14.4 6.3 14.4 3.9 15.4 C 3.3 16.4 3.3 18.3 3.9 19.3 C 6.3 18.3 9.3 18.3 12 19.5 C 14.7 18.3 17.7 18.3 20.1 19.3 C 20.7 18.3 20.7 16.4 20.1 15.4 C 17.7 14.4 14.7 14.4 12 15.6 Z"
        {...stroke}
      />
      <line x1="12" y1="15.9" x2="12" y2="19.4" {...stroke} />
    </svg>
  );
}
