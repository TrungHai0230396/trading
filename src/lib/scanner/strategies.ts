import { ema } from "@/lib/indicators/ema";
import { rsi } from "@/lib/indicators/rsi";
import { wma } from "@/lib/indicators/wma";

export type Signal = "BULLISH" | "BEARISH" | "NEUTRAL";

/**
 * Single strategy: port of `rsi_bot/core/indicators.py:analyze_symbol`.
 *
 *   rsi      = RSI(closes, 14)
 *   emaOnRsi = EMA(rsiSeries, 9)    (đường xanh lá)
 *   wmaOnRsi = WMA(rsiSeries, 45)   (đường xanh dương)
 *
 * Bullish khi đường xanh lá (EMA) cắt lên trên đường xanh dương (WMA).
 */
export type StrategyId = "ema-wma-on-rsi";

export type StrategyResult = {
  signal: Signal;
  indicators: Record<string, number>;
};

const STRATEGY_IDS: StrategyId[] = ["ema-wma-on-rsi"];

export function isStrategyId(s: string): s is StrategyId {
  return (STRATEGY_IDS as string[]).includes(s);
}

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  "ema-wma-on-rsi": "EMA(9) cắt WMA(45) trên RSI(14)",
};

export const DEFAULT_STRATEGY: StrategyId = "ema-wma-on-rsi";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function emaWmaOnRsiStrategy(closes: number[]): StrategyResult {
  const rsiSeries = rsi(closes, 14);
  const emaOnRsi = ema(rsiSeries, 9);
  const wmaOnRsi = wma(rsiSeries, 45);

  const last = closes.length - 1;
  const e = emaOnRsi[last];
  const w = wmaOnRsi[last];
  const rsiLast = rsiSeries[last];

  let signal: Signal = "NEUTRAL";
  if (Number.isFinite(e) && Number.isFinite(w)) {
    if (e > w) signal = "BULLISH";
    else if (e < w) signal = "BEARISH";
  }

  return {
    signal,
    indicators: {
      rsi: Number.isFinite(rsiLast) ? round2(rsiLast) : NaN,
      emaOnRsi: Number.isFinite(e) ? round2(e) : NaN,
      wmaOnRsi: Number.isFinite(w) ? round2(w) : NaN,
    },
  };
}

export function runStrategy(_id: StrategyId, closes: number[]): StrategyResult {
  // Only one strategy for now — id parameter kept for API compatibility.
  return emaWmaOnRsiStrategy(closes);
}

export const ALL_STRATEGIES: { id: StrategyId; label: string }[] =
  STRATEGY_IDS.map((id) => ({ id, label: STRATEGY_LABELS[id] }));
