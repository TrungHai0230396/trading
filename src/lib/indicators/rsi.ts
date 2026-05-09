/**
 * Relative Strength Index using Wilder's smoothing.
 * - First RSI value lands at index `period` (we need `period` deltas).
 * - Warmup elements are NaN.
 */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial averages from the first `period` deltas (indices 1..period).
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
