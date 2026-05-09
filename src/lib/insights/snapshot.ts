/**
 * Lightweight price snapshot for the insights page.
 *
 * Uses the existing 1h-candle fetcher (`getCandles`) — Binance for crypto,
 * Twelve Data for forex — and computes 24h / 7d % changes from those
 * closes. No additional fetches.
 *
 * Caching is inherited from the candle fetcher's
 * `next: { revalidate: 60 }` directive.
 */

import { getCandles, CandleFetchError } from "@/lib/scanner/candles";
import type { InsightMarket } from "@/lib/insights/curated";

export type PriceSnapshot = {
  price: number;
  changes: {
    "1d"?: number;
    "7d"?: number;
  };
  high24h?: number;
  low24h?: number;
};

function pctChange(latest: number, previous: number): number | undefined {
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
    return undefined;
  }
  return ((latest - previous) / previous) * 100;
}

export async function getPriceSnapshot(opts: {
  market: InsightMarket;
  symbol: string;
}): Promise<PriceSnapshot> {
  const { market, symbol } = opts;
  // 200 × 1h ≈ 8.3 days — enough for both 1d and 7d windows.
  const closes = await getCandles({
    market,
    symbol,
    timeframe: "1h",
    limit: 200,
  });

  if (closes.length === 0) {
    throw new CandleFetchError(`Không có dữ liệu nến cho ${symbol}.`);
  }

  const last = closes[closes.length - 1]!;
  const ago1d = closes.length > 24 ? closes[closes.length - 1 - 24] : undefined;
  const ago7d =
    closes.length > 24 * 7 ? closes[closes.length - 1 - 24 * 7] : undefined;

  // 24h high/low from the last 24 1h-closes (best-effort using closes only).
  const last24 = closes.slice(-24);
  const high24h =
    last24.length > 0 ? last24.reduce((a, b) => (b > a ? b : a), -Infinity) : undefined;
  const low24h =
    last24.length > 0 ? last24.reduce((a, b) => (b < a ? b : a), Infinity) : undefined;

  return {
    price: last,
    changes: {
      "1d": ago1d !== undefined ? pctChange(last, ago1d) : undefined,
      "7d": ago7d !== undefined ? pctChange(last, ago7d) : undefined,
    },
    high24h: Number.isFinite(high24h) ? high24h : undefined,
    low24h: Number.isFinite(low24h) ? low24h : undefined,
  };
}
