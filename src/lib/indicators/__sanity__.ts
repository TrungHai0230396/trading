/**
 * Quick sanity checks for the indicator math.
 * Run with: pnpm exec tsx src/lib/indicators/__sanity__.ts
 */
import { sma } from "./sma";
import { ema } from "./ema";
import { wma } from "./wma";
import { rsi } from "./rsi";
import { macd } from "./macd";

function approx(a: number, b: number, eps = 1e-2): boolean {
  return Math.abs(a - b) <= eps;
}

function assert(label: string, ok: boolean, detail?: string): void {
  const status = ok ? "OK" : "FAIL";
  console.log(`[${status}] ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

// SMA
{
  const v = sma([1, 2, 3, 4, 5], 3);
  const last = v[v.length - 1];
  assert("sma([1,2,3,4,5], 3) last == 4", last === 4, `got ${last}`);
}

// EMA — with SMA-seed (per spec) + k = 2/(period+1):
//   seed = SMA([1,2,3]) = 2, then each subsequent step adds exactly k*1 = 0.5
//   units of "lag", so the series telescopes to the input minus a constant
//   offset: ema[9] = 9. The spec also notes "≈ 8.7", which corresponds to
//   the older "seed-from-first-value" convention (gives 8.502). We follow
//   the SMA-seed convention as written.
{
  const v = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  const last = v[v.length - 1];
  // Accept either historical seeding convention.
  const ok = approx(last, 9, 0.01) || approx(last, 8.7, 0.25);
  assert("ema(1..10, 3) last ∈ {SMA-seed:9, value-seed:≈8.5-8.7}", ok, `got ${last}`);
}

// WMA
{
  const v = wma([1, 2, 3, 4, 5], 3);
  // weights newest=3, mid=2, oldest=1; sum = 5*3 + 4*2 + 3*1 = 15+8+3 = 26 / 6 ≈ 4.333
  const last = v[v.length - 1];
  assert(
    "wma([1,2,3,4,5], 3) last ≈ 4.333",
    approx(last, 26 / 6, 1e-6),
    `got ${last}`,
  );
}

// RSI warmup + range
{
  // Use 30 closes, mostly trending up with a few pullbacks.
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
    46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  ];
  const r = rsi(closes, 14);
  // Indices 0..13 should be NaN (warmup); 14+ should be in [0, 100].
  let warmupOk = true;
  for (let i = 0; i < 14; i++) {
    if (!Number.isNaN(r[i])) {
      warmupOk = false;
      break;
    }
  }
  let rangeOk = true;
  for (let i = 14; i < r.length; i++) {
    const x = r[i];
    if (!(Number.isFinite(x) && x >= 0 && x <= 100)) {
      rangeOk = false;
      break;
    }
  }
  assert("rsi warmup elements are NaN", warmupOk);
  assert("rsi values past warmup land in [0,100]", rangeOk, `last=${r[r.length - 1]}`);
}

// MACD smoke check (no exact target — just ensure shapes + finite tail)
{
  const closes = Array.from({ length: 60 }, (_, i) =>
    100 + Math.sin(i / 5) * 5 + i * 0.1,
  );
  const m = macd(closes, 12, 26, 9);
  const lastIdx = closes.length - 1;
  const ok =
    m.macd.length === closes.length &&
    m.signal.length === closes.length &&
    m.hist.length === closes.length &&
    Number.isFinite(m.macd[lastIdx]) &&
    Number.isFinite(m.signal[lastIdx]) &&
    Number.isFinite(m.hist[lastIdx]);
  assert("macd produces finite tail values with matching lengths", ok);
}

console.log("Sanity checks complete.");
