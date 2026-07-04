/**
 * Per-symbol analysis snapshot — orchestrates all the data fetches the
 * deep-dive page needs, then computes the deterministic trade plan +
 * recommendation. The AI narrative call is separate (see ai/symbol-
 * analysis.ts) so it can stream behind a Suspense boundary.
 *
 * Why this file (vs. inlining in the page)?
 * - The page Server Component should be thin orchestration.
 * - Both the page and a future /api endpoint can reuse this.
 * - Pure data — easy to type, easy to test.
 */

import { cache } from "react";
import { scanSymbol } from "@/lib/scanner/runner";
import { getOHLCV, type OHLCVBar } from "@/lib/scanner/ohlcv";
import { getBinance24hTicker } from "@/lib/quotes/binance";
import {
  getRelatedNews,
  type RelatedNewsItem,
} from "@/lib/insights/related-news";
import { lastAtr } from "@/lib/indicators/atr";
import {
  computeRecommendation,
  type RecommendationResult,
} from "./recommendation";
import {
  computeTradePlan,
  verdictToDirection,
  type TradePlan,
} from "./trade-plan";
import {
  nearestResistance,
  nearestSupport,
  recentLowHigh,
  type Swing,
} from "./swings";
import { parseCryptoSymbol } from "@/lib/calc/crypto-symbols";
import { findForexPair } from "@/lib/calc/forex-pairs";
import type {
  ScanSummaryEntry,
  PerTimeframeResult,
} from "@/lib/scanner/runner";

export type Market = "FOREX" | "CRYPTO";

export type PriceStats = {
  last: number;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
};

export type VolumeStats = {
  last24h: number;
  avg20d: number;
  ratio: number;
  classification: "high" | "low" | "normal";
};

export type AnalysisSnapshot = {
  symbol: string;
  base: string;
  market: Market;
  generatedAt: string;
  price: PriceStats;
  consensus: ScanSummaryEntry;
  /** Per-TF condensed signals — convenience for the AI prompt. */
  perTF: PerTimeframeResult[];
  /** ATR(14) on the timeframe we used for the trade plan. */
  atrValue: number | null;
  atrTimeframe: "4h" | "1d";
  swingLow: number | null;
  swingHigh: number | null;
  nearestResistance: Swing[];
  nearestSupport: Swing[];
  volume: VolumeStats | null;
  news: RelatedNewsItem[];
  recommendation: RecommendationResult;
  /** null when verdict is WAIT (no plan to execute yet). */
  tradePlan: TradePlan | null;
  /** Account context used to compute the plan. */
  accountBalance: number;
  riskPercent: number;
};

const DEFAULT_TFS = ["1h", "4h", "1d", "1w"] as const;
const TF_FOR_PLAN_CRYPTO: "4h" | "1d" = "4h";
const TF_FOR_PLAN_FOREX: "4h" | "1d" = "1d";

/**
 * Build the full snapshot. Pulls in parallel:
 *  - scanSymbol (4 timeframes × Binance candles)
 *  - 24h ticker (Binance) — crypto only
 *  - OHLCV for plan timeframe (60 bars, used for ATR + swings)
 *  - OHLCV 1d (60 bars, used for volume avg + structure scan)
 *  - Related news (DB only)
 *
 * Then synchronously computes: recommendation, trade plan, S/R levels.
 */
export async function buildAnalysisSnapshot(opts: {
  userId: string;
  market: Market;
  symbol: string;
  accountBalance?: number;
  riskPercent?: number;
}): Promise<AnalysisSnapshot> {
  const market = opts.market;
  const symbol = opts.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base =
    market === "CRYPTO"
      ? parseCryptoSymbol(symbol).base.toUpperCase()
      : (findForexPair(symbol)?.base ?? symbol.slice(0, 3)).toUpperCase();

  const accountBalance = opts.accountBalance ?? loadDefaultBalance();
  const riskPercent = opts.riskPercent ?? 0.01; // 1% default

  const planTF: "4h" | "1d" =
    market === "CRYPTO" ? TF_FOR_PLAN_CRYPTO : TF_FOR_PLAN_FOREX;

  // Kick off all expensive I/O in parallel.
  const [consensus, planTfBars, dailyBars, ticker, news] = await Promise.all([
    scanSymbol({
      runId: "",
      market,
      symbol,
      timeframes: [...DEFAULT_TFS],
      indicators: ["ema-wma-on-rsi"],
      limit: 200,
      persist: false,
    }),
    safeOhlcv({ market, symbol, timeframe: planTF, limit: 80 }),
    market === "CRYPTO"
      ? safeOhlcv({ market, symbol, timeframe: "1d", limit: 60 })
      : Promise.resolve<OHLCVBar[]>([]),
    market === "CRYPTO"
      ? safeTicker(symbol)
      : Promise.resolve<{
          lastPrice: number;
          priceChangePercent: number;
          highPrice: number;
          lowPrice: number;
          quoteVolume: number;
        } | null>(null),
    safeNews({ userId: opts.userId, market, symbol, limit: 8 }),
  ]);

  // Derive price stats. Prefer 24h ticker (Binance) when available,
  // fall back to last close of the plan-TF bars (forex path).
  const lastFromBars = planTfBars.length
    ? planTfBars[planTfBars.length - 1].c
    : null;
  const lastPrice = ticker?.lastPrice ?? lastFromBars ?? 0;
  const price: PriceStats = {
    last: lastPrice,
    change24hPct: ticker?.priceChangePercent ?? null,
    high24h: ticker?.highPrice ?? null,
    low24h: ticker?.lowPrice ?? null,
    quoteVolume24h: ticker?.quoteVolume ?? null,
  };

  // ATR for the plan timeframe.
  const atrValue =
    planTfBars.length >= 15 ? lastAtr(toAtrBars(planTfBars), 14) : null;

  // Recent swing low/high. For LONG trade plan we want the recent low
  // (stop reference); for SHORT we want the recent high. We pass both
  // and let trade-plan pick by direction.
  //
  // Use the plan-TF bars themselves so the structure reference matches
  // the volatility timeframe (a 4h scan should respect 4h swings).
  const { low: swingLow, high: swingHigh } = recentLowHigh(planTfBars, 30);

  const resistance = nearestResistance(
    dailyBars.length ? dailyBars : planTfBars,
    lastPrice,
    { lookback: 60, top: 3 },
  );
  const support = nearestSupport(
    dailyBars.length ? dailyBars : planTfBars,
    lastPrice,
    { lookback: 60, top: 3 },
  );

  // Volume stats — crypto only. Use 1d OHLCV: today's quote volume vs
  // 20-day average. Skip for forex.
  let volume: VolumeStats | null = null;
  if (market === "CRYPTO" && dailyBars.length >= 21 && ticker) {
    const recent20 = dailyBars.slice(-21, -1); // exclude today's incomplete bar
    const avg =
      recent20.reduce((s, b) => s + b.v, 0) / Math.max(recent20.length, 1);
    const today = ticker.quoteVolume;
    const ratio = avg > 0 ? today / avg : 0;
    volume = {
      last24h: today,
      avg20d: avg,
      ratio,
      classification:
        ratio > 1.7 ? "high" : ratio < 0.5 ? "low" : "normal",
    };
  }

  // News counts by sentiment — feed into recommendation.
  let newsBull = 0;
  let newsBear = 0;
  for (const n of news) {
    const s = (n.sentiment ?? "").toLowerCase();
    if (s.startsWith("bull") || s === "positive") newsBull++;
    else if (s.startsWith("bear") || s === "negative") newsBear++;
  }

  // RSI 1h / 4h from consensus per-TF (already computed by scanSymbol).
  const rsi1h = rsiFromTF(consensus.perTF.find((t) => t.timeframe === "1h"));
  const rsi4h = rsiFromTF(consensus.perTF.find((t) => t.timeframe === "4h"));

  const recommendation = computeRecommendation({
    consensusScore: consensus.score,
    alignment: consensus.alignment,
    rsi1h,
    rsi4h,
    newsBullishCount: newsBull,
    newsBearishCount: newsBear,
    volumeRatio: volume?.ratio ?? null,
  });

  // Trade plan only when we have a side. WAIT → no plan.
  let tradePlan: TradePlan | null = null;
  if (recommendation.verdict !== "WAIT" && lastPrice > 0 && atrValue !== null) {
    tradePlan = computeTradePlan({
      symbol,
      base,
      direction: verdictToDirection(recommendation.verdict),
      lastPrice,
      atr: atrValue,
      swingLow,
      swingHigh,
      accountBalance,
      riskPercent,
    });
  }

  return {
    symbol,
    base,
    market,
    generatedAt: new Date().toISOString(),
    price,
    consensus,
    perTF: consensus.perTF,
    atrValue,
    atrTimeframe: planTF,
    swingLow,
    swingHigh,
    nearestResistance: resistance,
    nearestSupport: support,
    volume,
    news,
    recommendation,
    tradePlan,
    accountBalance,
    riskPercent,
  };
}

// ── helpers ──────────────────────────────────────────────────────────

async function safeOhlcv(args: {
  market: Market;
  symbol: string;
  timeframe: "1h" | "4h" | "1d" | "1w";
  limit: number;
}): Promise<OHLCVBar[]> {
  try {
    return await getOHLCV(args);
  } catch {
    return [];
  }
}

async function safeTicker(symbol: string) {
  try {
    return await getBinance24hTicker(symbol);
  } catch {
    return null;
  }
}

async function safeNews(args: {
  userId: string;
  market: Market;
  symbol: string;
  limit: number;
}) {
  try {
    return await getRelatedNews(args);
  } catch {
    return [];
  }
}

function toAtrBars(bars: OHLCVBar[]) {
  return bars.map((b) => ({ high: b.h, low: b.l, close: b.c }));
}

function rsiFromTF(tf: PerTimeframeResult | undefined): number | null {
  if (!tf) return null;
  const strat = tf.perStrategy.find((p) => p.strategy === "ema-wma-on-rsi");
  if (!strat) return null;
  const v = strat.indicators.rsi;
  return Number.isFinite(v) ? v : null;
}

function loadDefaultBalance(): number {
  // Reasonable default for retail-trader analysis. Future: read from
  // settings table or user profile.
  return 1000;
}

/**
 * Request-scoped memoized snapshot — used by the page's Suspense boundaries.
 *
 * The page splits rendering into two boundaries: one for the data cards
 * (TA, volume, news, plan) and one for the AI narrative. Both need the
 * snapshot, but doing the expensive scan twice within one request would
 * double Binance calls + Gemini tokens. React's `cache()` deduplicates
 * the call across the request — first await does the work, second
 * await returns the same Promise.
 *
 * Caller passes the same args object identity is NOT required; cache()
 * keys by arg equality (Object.is). The orchestrator's args are simple
 * primitives so identity isn't an issue.
 */
export const getCachedAnalysisSnapshot = cache(
  async (
    userId: string,
    market: Market,
    symbol: string,
    accountBalance: number | undefined,
    riskPercent: number | undefined,
  ) =>
    buildAnalysisSnapshot({
      userId,
      market,
      symbol,
      accountBalance,
      riskPercent,
    }),
);
