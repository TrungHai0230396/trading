/**
 * Weighted Moving Average.
 * Weights are 1..period (newest bar = period).
 * Returns an array the same length as `values`; warmup elements are NaN.
 */
export function wma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;

  const denom = (period * (period + 1)) / 2;

  for (let i = period - 1; i < values.length; i++) {
    let num = 0;
    for (let j = 0; j < period; j++) {
      // Newest bar (offset 0 from i) gets weight `period`,
      // oldest bar in the window (offset period - 1) gets weight 1.
      const weight = period - j;
      num += values[i - j] * weight;
    }
    out[i] = num / denom;
  }
  return out;
}
