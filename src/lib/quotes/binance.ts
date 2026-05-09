/** Binance public spot ticker — no API key required. */

const BASE = "https://api.binance.com/api/v3";

export class BinanceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
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
