/** Unified quote facade. */

import { getBinancePrice } from "@/lib/quotes/binance";
import { getTwelveDataPrice } from "@/lib/quotes/twelvedata";
import { findForexPair, tdSymbol } from "@/lib/calc/forex-pairs";

export type Market = "FOREX" | "CRYPTO";

export type QuoteResponse = {
  market: Market;
  symbol: string;
  price: number;
  source: "binance" | "twelvedata";
  fetchedAt: string;
};

// Short-lived in-process cache. Both callers (the /api/quote endpoint and
// the journal live-quotes poller) are display-only, so ~8s of staleness is
// invisible to the user but collapses N users polling the same symbol into
// a single upstream call — protecting the shared TwelveData daily quota and
// keeping the server IP under Binance's public rate limit. Order sizing does
// NOT go through here (brokers use their own mark price), so caching is safe.
const CACHE_TTL_MS = 8_000;
const priceCache = new Map<string, { at: number; quote: QuoteResponse }>();

async function fetchPrice(
  market: Market,
  symbol: string,
): Promise<QuoteResponse> {
  if (market === "CRYPTO") {
    const price = await getBinancePrice(symbol);
    return {
      market,
      symbol: symbol.toUpperCase(),
      price,
      source: "binance",
      fetchedAt: new Date().toISOString(),
    };
  }

  const pair = findForexPair(symbol);
  const tdSym = pair ? pair.display : tdSymbol(symbol);
  const price = await getTwelveDataPrice(tdSym);
  return {
    market,
    symbol: pair?.symbol ?? symbol.toUpperCase(),
    price,
    source: "twelvedata",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPrice(
  market: Market,
  symbol: string,
): Promise<QuoteResponse> {
  const key = `${market}:${symbol.toUpperCase()}`;
  const now = Date.now();
  const hit = priceCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.quote;
  }

  const quote = await fetchPrice(market, symbol);
  priceCache.set(key, { at: now, quote });

  // Opportunistic eviction so the map can't grow unbounded over uptime.
  if (priceCache.size > 500) {
    for (const [k, v] of priceCache) {
      if (now - v.at >= CACHE_TTL_MS) priceCache.delete(k);
    }
  }

  return quote;
}
