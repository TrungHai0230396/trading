import { sma } from "./sma";

/**
 * Exponential Moving Average.
 * - Seeds with the first-period SMA.
 * - Multiplier = 2 / (period + 1).
 * Returns an array the same length as `values`; warmup elements are NaN.
 */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  const seed = sma(values.slice(0, period), period)[period - 1];
  out[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < values.length; i++) {
    const next = (values[i] - prev) * k + prev;
    out[i] = next;
    prev = next;
  }
  return out;
}
