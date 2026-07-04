/**
 * Recent swing high/low + nearest resistance/support scan, computed
 * from a chronological OHLCV series.
 *
 * "Swing" here = a pivot that sticks out vs its N-bar neighborhood.
 * For retail-grade TA we use a fractal-style detector: a bar is a swing
 * high if its high is strictly greater than `window` bars on each side;
 * mirror for swing low.
 *
 * "Nearest resistance/support" = the highest/lowest swing(s) within a
 * recent lookback window, returned sorted by distance from current
 * price. The AI prompt uses these so it can name specific price levels
 * instead of hallucinating them.
 */

import type { OHLCVBar } from "@/lib/scanner/ohlcv";

export type Swing = { index: number; price: number; t: number };

/**
 * Detect swing highs in the bar series. A bar at index i qualifies if
 * its high is strictly greater than the high of each of the `window`
 * bars on either side. Bars at the edges (where the window doesn't fit)
 * are skipped.
 */
export function findSwingHighs(bars: OHLCVBar[], window = 3): Swing[] {
  if (bars.length < window * 2 + 1) return [];
  const out: Swing[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const h = bars[i].h;
    let ok = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (bars[j].h >= h) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: h, t: bars[i].t });
  }
  return out;
}

export function findSwingLows(bars: OHLCVBar[], window = 3): Swing[] {
  if (bars.length < window * 2 + 1) return [];
  const out: Swing[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const l = bars[i].l;
    let ok = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (bars[j].l <= l) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: l, t: bars[i].t });
  }
  return out;
}

/**
 * Resistance levels above `currentPrice` from the last N bars, sorted
 * by closeness (nearest first). Returns up to `top` results.
 */
export function nearestResistance(
  bars: OHLCVBar[],
  currentPrice: number,
  opts: { window?: number; lookback?: number; top?: number } = {},
): Swing[] {
  const window = opts.window ?? 3;
  const lookback = opts.lookback ?? 60;
  const top = opts.top ?? 3;
  const recent = bars.slice(-lookback);
  return findSwingHighs(recent, window)
    .filter((s) => s.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, top);
}

export function nearestSupport(
  bars: OHLCVBar[],
  currentPrice: number,
  opts: { window?: number; lookback?: number; top?: number } = {},
): Swing[] {
  const window = opts.window ?? 3;
  const lookback = opts.lookback ?? 60;
  const top = opts.top ?? 3;
  const recent = bars.slice(-lookback);
  return findSwingLows(recent, window)
    .filter((s) => s.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, top);
}

/**
 * Plain min/max of low/high over the last `lookback` bars — used as a
 * fallback when fractal swings come back empty (low-data symbols).
 */
export function recentLowHigh(
  bars: OHLCVBar[],
  lookback = 20,
): { low: number | null; high: number | null } {
  if (bars.length === 0) return { low: null, high: null };
  const slice = bars.slice(-lookback);
  let low = Infinity;
  let high = -Infinity;
  for (const b of slice) {
    if (b.l < low) low = b.l;
    if (b.h > high) high = b.h;
  }
  return {
    low: Number.isFinite(low) ? low : null,
    high: Number.isFinite(high) ? high : null,
  };
}
