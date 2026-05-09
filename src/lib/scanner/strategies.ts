import { ema } from "@/lib/indicators/ema";
import { rsi } from "@/lib/indicators/rsi";
import { wma } from "@/lib/indicators/wma";

export type Signal = "BULLISH" | "BEARISH" | "NEUTRAL";

export type StrategyId = "rsi-ema-wma" | "macd-cross";

export type StrategyResult = {
  signal: Signal;
  indicators: Record<string, number>;
};

const STRATEGY_IDS: StrategyId[] = ["rsi-ema-wma", "macd-cross"];

export function isStrategyId(s: string): s is StrategyId {
  return (STRATEGY_IDS as string[]).includes(s);
}

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  "rsi-ema-wma": "RSI(14) + EMA9 / WMA45",
  "macd-cross": "EMA20 / EMA50 cross",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * RSI-EMA-WMA crossover (port of the user's RSI bot).
 *  - rsiSeries = RSI(closes, 14)
 *  - emaOnRsi  = EMA(rsiSeries, 9)
 *  - wmaOnRsi  = WMA(rsiSeries, 45)
 *  - emaOnRsi > wmaOnRsi → BULLISH; < → BEARISH; NaN/equal → NEUTRAL.
 */
export function rsiEmaWmaStrategy(closes: number[]): StrategyResult {
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

/**
 * EMA20 / EMA50 crossover (port of the user's MACD bot — its actual logic
 * is an EMA20/EMA50 cross, not the classic MACD line/signal cross).
 */
export function macdCrossStrategy(closes: number[]): StrategyResult {
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);

  const last = closes.length - 1;
  const a = e20[last];
  const b = e50[last];

  let signal: Signal = "NEUTRAL";
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (a > b) signal = "BULLISH";
    else if (a < b) signal = "BEARISH";
  }

  return {
    signal,
    indicators: {
      ema20: Number.isFinite(a) ? round2(a) : NaN,
      ema50: Number.isFinite(b) ? round2(b) : NaN,
    },
  };
}

export function runStrategy(id: StrategyId, closes: number[]): StrategyResult {
  switch (id) {
    case "rsi-ema-wma":
      return rsiEmaWmaStrategy(closes);
    case "macd-cross":
      return macdCrossStrategy(closes);
  }
}

export const ALL_STRATEGIES: { id: StrategyId; label: string }[] =
  STRATEGY_IDS.map((id) => ({ id, label: STRATEGY_LABELS[id] }));
