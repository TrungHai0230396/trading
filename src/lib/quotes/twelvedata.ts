/** Twelve Data forex/crypto quote — needs TWELVE_DATA_API_KEY. */

const BASE = "https://api.twelvedata.com";

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
