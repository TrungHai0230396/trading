/**
 * Average True Range (ATR) — Wilder's smoothing.
 *
 * Wilder ATR uses the recursive smoothing formula:
 *   atr[t] = (atr[t-1] * (period-1) + tr[t]) / period
 *   atr[period] = SMA of first `period` true ranges (seed)
 *
 * Most charting platforms (TradingView, MT4) ship this exact convention,
 * so values here should line up with what a trader sees on their chart.
 *
 * Inputs are arrays of OHLC bars; outputs are arrays the same length with
 * leading `NaN` slots until enough data has accumulated for the seed.
 */

export type AtrBar = { high: number; low: number; close: number };

/**
 * True Range per bar:
 *   tr = max(high - low, |high - prevClose|, |low - prevClose|)
 *
 * For the very first bar there's no prevClose; we fall back to
 * (high - low) so the array length matches the input.
 */
export function trueRange(bars: AtrBar[]): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length === 0) return out;
  out[0] = Math.abs(bars[0].high - bars[0].low);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].close;
    const a = b.high - b.low;
    const c = Math.abs(b.high - prevClose);
    const d = Math.abs(b.low - prevClose);
    out[i] = Math.max(a, c, d);
  }
  return out;
}

/**
 * Wilder ATR. Default period = 14 matching most charts.
 *
 * Returns an array same length as input; values are NaN until index
 * `period - 1` (first full SMA window).
 */
export function atr(bars: AtrBar[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (period <= 0 || bars.length < period) return out;

  const tr = trueRange(bars);

  // Seed: simple average of the first `period` TR values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  out[period - 1] = seed / period;

  // Wilder smoothing for the rest.
  for (let i = period; i < bars.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }

  return out;
}

/** Convenience: just the latest finite ATR value, or null if unavailable. */
export function lastAtr(bars: AtrBar[], period = 14): number | null {
  const series = atr(bars, period);
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}
