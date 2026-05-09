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

export async function getPrice(
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
