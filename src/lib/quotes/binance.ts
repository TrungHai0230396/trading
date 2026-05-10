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
  const res = await fetch(`${BASE}/ticker/24hr`, {
    next: { revalidate: 60 },
  });
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
