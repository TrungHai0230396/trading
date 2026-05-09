/**
 * RSI matching the user's `rsi_bot/core/indicators.py` exactly.
 *
 * Source uses pandas:
 *   gain  = delta.where(delta > 0, 0)
 *   loss  = (-delta).where(delta < 0, 0)
 *   avg_gain = gain.ewm(alpha=1/length, min_periods=length).mean()
 *   avg_loss = loss.ewm(alpha=1/length, min_periods=length).mean()
 *   rsi = 100 - 100 / (1 + avg_gain / avg_loss)
 *
 * That's pandas EWM with adjust=True (the default), so we use the recursive
 * accumulator form:
 *   num[t] = (1-α) num[t-1] + x[t]
 *   den[t] = (1-α) den[t-1] + 1
 *   ewm[t] = num[t] / den[t]   (NaN until min_periods observations seen)
 *
 * The first delta is undefined; pandas .where on a NaN delta returns the
 * "other" branch (0), so we seed gains[0] = losses[0] = 0.
 */
function ewmAdjustTrue(
  values: number[],
  alpha: number,
  minPeriods: number,
): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;

  const c = 1 - alpha;
  let num = 0;
  let den = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    num = c * num + v;
    den = c * den + 1;
    count++;
    if (count >= minPeriods) {
      out[i] = num / den;
    }
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (period <= 0 || closes.length === 0) return out;

  const gains = new Array<number>(closes.length).fill(0);
  const losses = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains[i] = d;
    else if (d < 0) losses[i] = -d;
  }

  const alpha = 1 / period;
  const avgGain = ewmAdjustTrue(gains, alpha, period);
  const avgLoss = ewmAdjustTrue(losses, alpha, period);

  for (let i = 0; i < closes.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) continue;
    if (l === 0) {
      out[i] = 100;
    } else {
      out[i] = 100 - 100 / (1 + g / l);
    }
  }
  return out;
}
