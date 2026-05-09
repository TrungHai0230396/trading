import { ema } from "./ema";

export type MacdResult = {
  macd: number[];
  signal: number[];
  hist: number[];
};

/**
 * Classic MACD: fast EMA - slow EMA, with EMA-of-MACD as the signal line.
 * Each output array is the same length as `values` (NaN during warmup).
 */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MacdResult {
  const len = values.length;
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);

  const line = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (Number.isFinite(f) && Number.isFinite(s)) {
      line[i] = f - s;
    }
  }

  // Run signal-EMA only over the populated portion of the MACD line so the
  // EMA seed isn't poisoned by NaNs.
  const firstValid = line.findIndex((v) => Number.isFinite(v));
  const sig = new Array<number>(len).fill(NaN);
  if (firstValid >= 0 && len - firstValid >= signal) {
    const sigSlice = ema(line.slice(firstValid), signal);
    for (let i = 0; i < sigSlice.length; i++) {
      sig[firstValid + i] = sigSlice[i];
    }
  }

  const hist = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (Number.isFinite(line[i]) && Number.isFinite(sig[i])) {
      hist[i] = line[i] - sig[i];
    }
  }

  return { macd: line, signal: sig, hist };
}
