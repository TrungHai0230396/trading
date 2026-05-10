/**
 * Multi-timeframe scanner runner.
 *
 * For every (symbol × timeframe) pair we fetch closes, run each requested
 * strategy, persist an AnalysisResult, and aggregate per symbol into a
 * 0..100 alignment score.
 */

import { db } from "@/lib/db";
import { MarketType } from "@/generated/prisma";
import { getTopBinanceUsdtSymbols } from "@/lib/quotes/binance";
import {
  getCandles,
  isTimeframe,
  type Market,
  type Timeframe,
} from "./candles";
import {
  isStrategyId,
  runStrategy,
  type Signal,
  type StrategyId,
} from "./strategies";

export type PerTimeframeResult = {
  timeframe: Timeframe;
  signal: Signal;
  perStrategy: Array<{
    strategy: StrategyId;
    signal: Signal;
    indicators: Record<string, number>;
  }>;
  error?: string;
};

export type ScanSummaryEntry = {
  symbol: string;
  score: number;
  alignment: "BULLISH" | "BEARISH" | "MIXED";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  perTF: PerTimeframeResult[];
};

export type ConsensusTopEntry = {
  symbol: string;
  score: number;
  alignment: "BULLISH" | "BEARISH";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  perTF: PerTimeframeResult[];
};

export type ScanResult = {
  runId: string;
  summary: ScanSummaryEntry[];
  consensusTop?: {
    bullish: ConsensusTopEntry[];
    bearish: ConsensusTopEntry[];
  };
};

const CONCURRENCY = 5;

function aggregateSignal(signals: Signal[]): Signal {
  let bull = 0;
  let bear = 0;
  for (const s of signals) {
    if (s === "BULLISH") bull++;
    else if (s === "BEARISH") bear++;
  }
  if (bull > 0 && bear === 0) return "BULLISH";
  if (bear > 0 && bull === 0) return "BEARISH";
  return "NEUTRAL";
}

function alignmentLabel(
  bull: number,
  bear: number,
): "BULLISH" | "BEARISH" | "MIXED" {
  if (bull > 0 && bear === 0) return "BULLISH";
  if (bear > 0 && bull === 0) return "BEARISH";
  return "MIXED";
}

function score(bull: number, bear: number, total: number): number {
  if (total <= 0) return 50;
  if (bull === total) return 100;
  if (bear === total) return 0;
  return 50 + ((bull - bear) / total) * 50;
}

function toSummaryEntry(
  symbol: string,
  perTF: PerTimeframeResult[],
): ScanSummaryEntry {
  let bull = 0;
  let bear = 0;
  let neutral = 0;
  for (const tf of perTF) {
    if (tf.signal === "BULLISH") bull++;
    else if (tf.signal === "BEARISH") bear++;
    else neutral++;
  }
  const total = perTF.length;

  return {
    symbol,
    score: Math.round(score(bull, bear, total) * 10) / 10,
    alignment: alignmentLabel(bull, bear),
    bullishCount: bull,
    bearishCount: bear,
    neutralCount: neutral,
    perTF,
  };
}

async function scanSymbol(args: {
  runId: string;
  market: Market;
  symbol: string;
  timeframes: Timeframe[];
  indicators: StrategyId[];
  limit: number;
  persist: boolean;
}): Promise<ScanSummaryEntry> {
  const perTF: PerTimeframeResult[] = [];

  for (const tf of args.timeframes) {
    try {
      const closes = await getCandles({
        market: args.market,
        symbol: args.symbol,
        timeframe: tf,
        limit: args.limit,
      });

      const perStrategy = args.indicators.map((id) => {
        const r = runStrategy(id, closes);
        return {
          strategy: id,
          signal: r.signal,
          indicators: r.indicators,
        };
      });

      const tfSignal = aggregateSignal(perStrategy.map((p) => p.signal));

      perTF.push({ timeframe: tf, signal: tfSignal, perStrategy });

      if (args.persist) {
        await db.analysisResult.create({
          data: {
            runId: args.runId,
            symbol: args.symbol,
            timeframe: tf,
            signal: tfSignal,
            score:
              tfSignal === "BULLISH" ? 100 : tfSignal === "BEARISH" ? 0 : 50,
            indicators: perStrategy as unknown as object,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi";
      perTF.push({
        timeframe: tf,
        signal: "NEUTRAL",
        perStrategy: [],
        error: message,
      });

      if (args.persist) {
        await db.analysisResult.create({
          data: {
            runId: args.runId,
            symbol: args.symbol,
            timeframe: tf,
            signal: "NEUTRAL",
            score: null,
            indicators: { error: message } as unknown as object,
          },
        });
      }
    }
  }

  return toSummaryEntry(args.symbol, perTF);
}

async function processBatch<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(size, items.length) }, () =>
    next(),
  );
  await Promise.all(workers);
  return out;
}

export async function runScan(opts: {
  userId: string;
  market: Market;
  symbols: string[];
  timeframes: string[];
  indicators: string[];
  limitPerTF?: number;
  name?: string;
  includeConsensusTop?: boolean;
}): Promise<ScanResult> {
  const symbols = Array.from(
    new Set(opts.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  );
  if (symbols.length === 0 && !opts.includeConsensusTop) {
    throw new Error("Cần ít nhất một symbol.");
  }

  const timeframes: Timeframe[] = Array.from(new Set(opts.timeframes)).filter(
    isTimeframe,
  );
  if (timeframes.length === 0) throw new Error("Cần ít nhất một khung thời gian.");

  const indicators: StrategyId[] = Array.from(new Set(opts.indicators)).filter(
    isStrategyId,
  );
  if (indicators.length === 0) throw new Error("Cần ít nhất một chỉ báo.");

  const limit = Math.max(50, Math.min(1000, opts.limitPerTF ?? 200));

  // Persist the run shell first so we can write results as we go.
  const run = await db.analysisRun.create({
    data: {
      userId: opts.userId,
      name: opts.name ?? null,
      market: opts.market as MarketType,
      symbols: symbols as unknown as object,
      timeframes: timeframes as unknown as object,
      indicators: indicators as unknown as object,
      config: { limitPerTF: limit },
    },
  });

  const summary = await processBatch(symbols, CONCURRENCY, (symbol) =>
    scanSymbol({
      runId: run.id,
      market: opts.market,
      symbol,
      timeframes,
      indicators,
      limit,
      persist: true,
    }),
  );

  // Sort: highest score first; ties broken by symbol for stability.
  summary.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  let consensusTop: ScanResult["consensusTop"];

  if (opts.includeConsensusTop && opts.market === "CRYPTO") {
    const consensusUniverse = await getTopBinanceUsdtSymbols(100);

    const consensusSummary = await processBatch(
      consensusUniverse,
      CONCURRENCY,
      (symbol) =>
        scanSymbol({
          runId: run.id,
          market: opts.market,
          symbol,
          timeframes,
          indicators,
          limit,
          persist: false,
        }),
    );

    const bullish = consensusSummary
      .filter(
        (row): row is ConsensusTopEntry =>
          row.alignment === "BULLISH" && row.bullishCount === timeframes.length,
      )
      .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
      .slice(0, 10);

    const bearish = consensusSummary
      .filter(
        (row): row is ConsensusTopEntry =>
          row.alignment === "BEARISH" && row.bearishCount === timeframes.length,
      )
      .sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol))
      .slice(0, 10);

    consensusTop = {
      bullish,
      bearish,
    };
  }

  return {
    runId: run.id,
    summary,
    consensusTop,
  };
}
