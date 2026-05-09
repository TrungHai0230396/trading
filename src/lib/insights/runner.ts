/**
 * Orchestrate per-symbol AI insights:
 *
 *   for each symbol (concurrency 4):
 *     1. price snapshot (1h candles → 24h / 7d % change)
 *     2. recent related news (NewsArticle rows)
 *     3. Gemini → bullish % + reasoning
 *
 * Per-symbol failures land in `errors[]` and don't abort the rest of
 * the batch. Sorted by `bullishPercent` descending.
 *
 * V1: results are NOT persisted. The page reruns analysis on demand —
 * we'll add a `MarketInsight` table later if usage warrants it.
 */

import {
  analyzeSymbolVi,
  type InsightConfidence,
  type InsightDirection,
} from "@/lib/ai/insights";
import {
  getPriceSnapshot,
  type PriceSnapshot,
} from "@/lib/insights/snapshot";
import { getRelatedNews } from "@/lib/insights/related-news";
import { normalizeSymbol, type InsightMarket } from "@/lib/insights/curated";

export type InsightItem = {
  symbol: string;
  market: InsightMarket;
  price: number;
  change1d?: number;
  change7d?: number;
  high24h?: number;
  low24h?: number;
  bullishPercent: number;
  direction: InsightDirection;
  reasoning: string;
  keyDrivers: string[];
  confidence: InsightConfidence;
  aiModel: string;
  newsCount: number;
};

export type InsightError = {
  symbol: string;
  message: string;
};

export type InsightRunResult = {
  items: InsightItem[];
  errors: InsightError[];
  generatedAt: string;
};

async function runOne(args: {
  userId: string;
  market: InsightMarket;
  symbol: string;
}): Promise<InsightItem> {
  const { userId, market, symbol } = args;
  const [snapshot, news]: [PriceSnapshot, Awaited<ReturnType<typeof getRelatedNews>>] =
    await Promise.all([
      getPriceSnapshot({ market, symbol }),
      getRelatedNews({ userId, symbol, market, limit: 5 }),
    ]);

  const ai = await analyzeSymbolVi({ market, symbol, snapshot, news });

  return {
    symbol,
    market,
    price: snapshot.price,
    change1d: snapshot.changes["1d"],
    change7d: snapshot.changes["7d"],
    high24h: snapshot.high24h,
    low24h: snapshot.low24h,
    bullishPercent: ai.bullishPercent,
    direction: ai.direction,
    reasoning: ai.reasoning,
    keyDrivers: ai.keyDrivers,
    confidence: ai.confidence,
    aiModel: ai.aiModel,
    newsCount: news.length,
  };
}

export async function runInsights(args: {
  userId: string;
  market: InsightMarket;
  symbols: readonly string[];
  concurrency?: number;
}): Promise<InsightRunResult> {
  const concurrency = Math.max(1, Math.min(args.concurrency ?? 4, 8));
  // Dedupe + normalize while preserving input order.
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const raw of args.symbols) {
    const s = normalizeSymbol(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    symbols.push(s);
  }

  const items: InsightItem[] = [];
  const errors: InsightError[] = [];

  for (let i = 0; i < symbols.length; i += concurrency) {
    const slice = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map((sym) =>
        runOne({ userId: args.userId, market: args.market, symbol: sym }),
      ),
    );
    settled.forEach((s, idx) => {
      const sym = slice[idx]!;
      if (s.status === "fulfilled") {
        items.push(s.value);
      } else {
        const reason = s.reason;
        errors.push({
          symbol: sym,
          message:
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
                ? reason
                : "Lỗi không xác định",
        });
      }
    });
  }

  // Sort items by bullishPercent desc, then alphabetically as a stable
  // tiebreaker so reruns produce consistent ordering.
  items.sort((a, b) => {
    if (b.bullishPercent !== a.bullishPercent) {
      return b.bullishPercent - a.bullishPercent;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    items,
    errors,
    generatedAt: new Date().toISOString(),
  };
}
