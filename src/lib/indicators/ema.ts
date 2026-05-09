/**
 * Exponential Moving Average matching pandas `Series.ewm(span=period,
 * adjust=False).mean()`.
 *
 *   α = 2 / (period + 1)
 *   y[seed] = x[seed]   (where seed = first non-NaN index)
 *   y[t]    = α x[t] + (1 - α) y[t-1]
 *
 * NaN handling matches the source RSI bot's pipeline: if the input has
 * leading NaN warmup (as RSI does), we skip past it and seed at the first
 * finite value rather than poisoning the whole series.
 */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length === 0) return out;

  let firstValid = -1;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      firstValid = i;
      break;
    }
  }
  if (firstValid === -1) return out;

  const alpha = 2 / (period + 1);
  let prev = values[firstValid];
  out[firstValid] = prev;

  for (let i = firstValid + 1; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      // pandas with ignore_na=False keeps prev; we leave this slot NaN.
      // The next finite value resumes from the prior smoothed y.
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}
