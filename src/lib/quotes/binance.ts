/**
 * Binance public spot ticker — no API key required.
 *
 * Every call goes through the shared egress guard (lib/net/binance-guard):
 * one server IP now serves every signed-up user, so these need an in-process
 * TTL + coalescing, a 429/418 circuit breaker, and weight-aware pacing.
 * Never Next's fetch cache — see the comment in scanner/candles.ts.
 */

import {
  BINANCE_WEIGHT,
  BinanceGuardError,
  binanceJson,
  type BinancePriority,
} from "@/lib/net/binance-guard";

type Binance24hrTicker = {
  symbol: string;
  quoteVolume: string;
};

export class BinanceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Guard failures already carry a user-ready Vietnamese message. */
function toBinanceError(e: unknown, fallback: string): BinanceError {
  if (e instanceof BinanceGuardError) {
    return new BinanceError(
      e.status === 429 || e.status === 418
        ? e.message
        : `${fallback} (HTTP ${e.status}).`,
      e.status,
    );
  }
  if (e instanceof BinanceError) return e;
  if (e instanceof Error && e.name === "TimeoutError") {
    return new BinanceError(`${fallback} — Binance không phản hồi.`);
  }
  return new BinanceError(fallback);
}

/**
 * /api/v3/ticker/24hr with NO symbol is the single most expensive request in
 * the codebase: weight 80 against Binance's IP budget, versus 2 for a kline
 * fetch. It also feeds the consensus universe, which the cron needs every 15
 * minutes — so it gets the longest TTL in the app. A 24h-volume ranking of
 * the top 100 USDT pairs simply does not reorder meaningfully inside 10
 * minutes, and the guard caches the raw response, so callers asking for
 * different `limit`s still share one upstream call.
 */
const TOP_SYMBOLS_TTL_MS = 10 * 60_000;

export async function getTopBinanceUsdtSymbols(
  limit = 100,
  priority?: BinancePriority,
): Promise<string[]> {
  let data: Binance24hrTicker[];
  try {
    data = await binanceJson<Binance24hrTicker[]>({
      path: "/api/v3/ticker/24hr",
      ttlMs: TOP_SYMBOLS_TTL_MS,
      weight: BINANCE_WEIGHT.ticker24hAll,
      priority,
      // 100x the payload of a normal call — give it room before aborting.
      timeoutMs: 20_000,
    });
  } catch (e) {
    throw toBinanceError(e, "Không lấy được bảng giá 24h của Binance");
  }

  return data
    .filter(
      (ticker) =>
        ticker.symbol.endsWith("USDT") &&
        !ticker.symbol.endsWith("DOWNUSDT") &&
        !ticker.symbol.endsWith("UPUSDT"),
    )
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((ticker) => ticker.symbol);
}

export type Binance24hTicker = {
  lastPrice: number;
  priceChangePercent: number; // 24h %
  highPrice: number;
  lowPrice: number;
  quoteVolume: number; // 24h volume in quote (USDT for *USDT pairs)
};

/**
 * /api/v3/ticker/24hr — single-symbol 24h rollup. Used by the analysis
 * page to render hero stats (current price, 24h %, high/low, volume)
 * without re-fetching all the klines.
 *
 * 20s TTL: these are headline stats next to a chart, not an execution
 * price, so a few seconds of age is invisible while N users opening the
 * same coin collapse into one call.
 */
export async function getBinance24hTicker(
  symbol: string,
): Promise<Binance24hTicker> {
  const sym = symbol.toUpperCase().replace("/", "");
  let d: Record<string, string>;
  try {
    d = await binanceJson<Record<string, string>>({
      path: "/api/v3/ticker/24hr",
      search: { symbol: sym },
      ttlMs: 20_000,
      weight: BINANCE_WEIGHT.ticker24hSymbol,
    });
  } catch (e) {
    if (e instanceof BinanceGuardError && e.status === 400) {
      throw new BinanceError(`Symbol "${sym}" không có trên Binance.`, 400);
    }
    throw toBinanceError(e, `Không lấy được thống kê 24h của ${sym}`);
  }
  return {
    lastPrice: Number(d.lastPrice),
    priceChangePercent: Number(d.priceChangePercent),
    highPrice: Number(d.highPrice),
    lowPrice: Number(d.lowPrice),
    quoteVolume: Number(d.quoteVolume),
  };
}

/**
 * Last traded price. 5s TTL — this backs the journal's live-quote poller,
 * so it must still feel live; the caller in quotes/index.ts layers its own
 * 8s cache on top. (This replaced `next: { revalidate: 5 }`, which could
 * serve far older data than 5s via stale-while-revalidate.)
 */
export async function getBinancePrice(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  let data: { symbol: string; price: string };
  try {
    data = await binanceJson<{ symbol: string; price: string }>({
      path: "/api/v3/ticker/price",
      search: { symbol: sym },
      ttlMs: 5_000,
      weight: BINANCE_WEIGHT.tickerPrice,
    });
  } catch (e) {
    if (e instanceof BinanceGuardError && e.status === 400) {
      throw new BinanceError(`Symbol "${sym}" not found on Binance.`, 400);
    }
    throw toBinanceError(e, `Không lấy được giá ${sym} từ Binance`);
  }
  return Number(data.price);
}
