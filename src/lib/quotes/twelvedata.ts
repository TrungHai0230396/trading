/** Twelve Data forex/crypto quote — needs TWELVE_DATA_API_KEY. */

import { sharedBudget } from "@/lib/brokers/rate-limit";

const BASE = "https://api.twelvedata.com";

// Same shared-key budget as the candle fetcher — a symbol-rotating loop on
// /api/quote (each distinct symbol misses the 8s cache) or a 30-symbol
// live-quotes poll must not outrun the owner's TwelveData daily quota.
const TD_PER_MINUTE = 7;
const TD_PER_DAY = 700;

export class TwelveDataError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function apiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    throw new TwelveDataError(
      "TWELVE_DATA_API_KEY is not set. Add it to your .env or via Settings.",
    );
  }
  return key;
}

/**
 * Fetch the current price.
 * `symbol` examples: "EUR/USD", "USD/JPY", "BTC/USD".
 */
export async function getTwelveDataPrice(symbol: string): Promise<number> {
  if (!sharedBudget("twelvedata", TD_PER_MINUTE, TD_PER_DAY)) {
    throw new TwelveDataError(
      "Đã đạt giới hạn giá forex chung lúc này. Thử lại sau ít phút.",
      429,
    );
  }

  const url = new URL("/price", BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey());

  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) {
    throw new TwelveDataError(`Twelve Data HTTP ${res.status}`, res.status);
  }
  const data = (await res.json()) as
    | { price: string }
    | { code: number; message: string; status: string };

  if ("code" in data) {
    throw new TwelveDataError(`Twelve Data: ${data.message}`, data.code);
  }
  return Number(data.price);
}
