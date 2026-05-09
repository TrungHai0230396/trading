/**
 * Quick sanity checks for the indicator math.
 * Run with: pnpm exec tsx src/lib/indicators/__sanity__.ts
 */
import { sma } from "./sma";
import { ema } from "./ema";
import { wma } from "./wma";
import { rsi } from "./rsi";
import { emaWmaOnRsiStrategy } from "@/lib/scanner/strategies";

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

// EMA — pandas adjust=False, seeds at first valid value, α = 2/(N+1).
//   y[0]=1, y[t]=0.5*x[t]+0.5*y[t-1]; closed-form y[9] = 9.001953125.
{
  const v = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  const last = v[v.length - 1];
  assert(
    "ema(1..10, 3) last ≈ 9.002 (adjust=False)",
    approx(last, 9.001953125, 1e-6),
    `got ${last}`,
  );
}

// EMA on a series with leading NaN (RSI-style warmup) must seed at the
// first valid value, not poison the whole series with NaN.
{
  const series = [NaN, NaN, NaN, 50, 51, 52, 53, 54, 55, 56];
  const v = ema(series, 3);
  const last = v[v.length - 1];
  assert(
    "ema with leading NaN seeds at first valid value",
    Number.isFinite(last) && last > 50 && last < 56,
    `got ${last}`,
  );
}

// WMA
{
  const v = wma([1, 2, 3, 4, 5], 3);
  // weights newest=3, mid=2, oldest=1; (5*3 + 4*2 + 3*1) / 6 ≈ 4.333
  const last = v[v.length - 1];
  assert(
    "wma([1,2,3,4,5], 3) last ≈ 4.333",
    approx(last, 26 / 6, 1e-6),
    `got ${last}`,
  );
}

// RSI warmup + range
{
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
    46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  ];
  const r = rsi(closes, 14);
  let warmupOk = true;
  for (let i = 0; i < 13; i++) {
    if (!Number.isNaN(r[i])) {
      warmupOk = false;
      break;
    }
  }
  let rangeOk = true;
  for (let i = 13; i < r.length; i++) {
    const x = r[i];
    if (!(Number.isFinite(x) && x >= 0 && x <= 100)) {
      rangeOk = false;
      break;
    }
  }
  assert("rsi indices 0..12 are NaN", warmupOk);
  assert(
    "rsi values from index 13 land in [0,100]",
    rangeOk,
    `last=${r[r.length - 1]}`,
  );
}

// End-to-end: the strategy must produce a real signal on a noisy uptrend.
// (A perfectly monotonic uptrend pegs RSI at 100 → EMA == WMA == 100 → NEUTRAL,
// which is technically correct but useless for testing the fix.)
// The previous bug had EMA collapsing to NaN on a leading-NaN RSI series,
// making every scan return NEUTRAL regardless of trend.
{
  const closes: number[] = [];
  // Uptrend with realistic noise: drift +0.3/bar plus a sin swing of ±5
  // strong enough to produce occasional loss bars (so RSI doesn't peg at 100).
  for (let i = 0; i < 200; i++) {
    closes.push(100 + i * 0.3 + Math.sin(i) * 5);
  }
  const r = emaWmaOnRsiStrategy(closes);
  const isFinite =
    Number.isFinite(r.indicators.emaOnRsi) &&
    Number.isFinite(r.indicators.wmaOnRsi);
  assert(
    "ema-wma-on-rsi strategy produces finite EMA/WMA values",
    isFinite,
    `indicators=${JSON.stringify(r.indicators)}`,
  );
  // The fix being checked is "EMA on RSI no longer poisons to NaN" — that
  // means signal must be either BULLISH or BEARISH, never NEUTRAL on data
  // with real movement.
  assert(
    "ema-wma-on-rsi strategy emits a real signal (not NEUTRAL/NaN)",
    r.signal !== "NEUTRAL",
    `signal=${r.signal}, indicators=${JSON.stringify(r.indicators)}`,
  );
}

console.log("Sanity checks complete.");
