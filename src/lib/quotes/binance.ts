/** Binance public spot ticker — no API key required. */

const BASE = "https://api.binance.com/api/v3";

type Binance24hrTicker = {
  symbol: string;
  quoteVolume: string;
};

export class BinanceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function getTopBinanceUsdtSymbols(limit = 100): Promise<string[]> {
  // No cache: see candles.ts for why — stale-while-revalidate can serve
  // data days old after an idle period.
  const res = await fetch(`${BASE}/ticker/24hr`, { cache: "no-store" });
  if (!res.ok) {
    throw new BinanceError(`Binance 24hr ticker error ${res.status}`, res.status);
  }

  const data = (await res.json()) as Binance24hrTicker[];

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
 */
export async function getBinance24hTicker(
  symbol: string,
): Promise<Binance24hTicker> {
  const sym = symbol.toUpperCase().replace("/", "");
  const url = new URL(`${BASE}/ticker/24hr`);
  url.searchParams.set("symbol", sym);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 400) {
      throw new BinanceError(`Symbol "${sym}" không có trên Binance.`, 400);
    }
    throw new BinanceError(`Binance ticker error ${res.status}`, res.status);
  }
  const d = (await res.json()) as Record<string, string>;
  return {
    lastPrice: Number(d.lastPrice),
    priceChangePercent: Number(d.priceChangePercent),
    highPrice: Number(d.highPrice),
    lowPrice: Number(d.lowPrice),
    quoteVolume: Number(d.quoteVolume),
  };
}

export async function getBinancePrice(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const res = await fetch(`${BASE}/ticker/price?symbol=${sym}`, {
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    if (res.status === 400) {
      throw new BinanceError(`Symbol "${sym}" not found on Binance.`, 400);
    }
    throw new BinanceError(`Binance error ${res.status}`, res.status);
  }
  const data = (await res.json()) as { symbol: string; price: string };
  return Number(data.price);
}
