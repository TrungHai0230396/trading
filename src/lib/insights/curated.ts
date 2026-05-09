/**
 * Curated default top-10 lists for the AI insights page.
 *
 * Strategy: curated symbols are ALWAYS shown for their market and cannot
 * be removed. The user can add EXTRA symbols (persisted as
 * `WatchlistSymbol`) and remove only those user-added entries. This
 * keeps the schema unchanged (no "hidden" flag needed) and the data
 * model dead-simple.
 */
import type { MarketType } from "@/generated/prisma";

export type InsightMarket = Extract<MarketType, "FOREX" | "CRYPTO">;

export const CURATED_FOREX: readonly string[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "NZDUSD",
  "EURJPY",
  "GBPJPY",
  "EURGBP",
] as const;

export const CURATED_CRYPTO: readonly string[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "TONUSDT",
] as const;

export function getCurated(market: InsightMarket): readonly string[] {
  return market === "FOREX" ? CURATED_FOREX : CURATED_CRYPTO;
}

/** Normalize: uppercase + strip slashes. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\//g, "");
}

export function isCurated(market: InsightMarket, symbol: string): boolean {
  const norm = normalizeSymbol(symbol);
  return getCurated(market).includes(norm);
}

/**
 * Merge curated list with user-added watchlist symbols (from
 * `WatchlistSymbol`). Curated come first (preserved order); user-added
 * unique entries follow. Deduped, normalized.
 */
export function mergeSymbols(
  market: InsightMarket,
  userSymbols: readonly string[],
): string[] {
  const curated = getCurated(market);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of curated) {
    const n = normalizeSymbol(s);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  for (const s of userSymbols) {
    const n = normalizeSymbol(s);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
