/**
 * TradingView chart URL builders — shared between the scanner list and
 * the analysis detail page so both produce the same external chart link.
 *
 * Symbol mapping is exchange-specific:
 *   - CRYPTO  → BINANCE:{SYMBOL}   (e.g. BINANCE:BTCUSDT)
 *   - FOREX   → OANDA:{SYMBOL}     (e.g. OANDA:EURUSD)
 *
 * Caller may pass an already-prefixed symbol (e.g. "BINANCE:BTCUSDT") —
 * we detect the colon and pass through unchanged.
 */

import type { Market, Timeframe } from "@/lib/scanner/candles";

export type TradingViewSelection = {
  symbol: string;
  market: Market;
  timeframe: Timeframe;
};

export function tradingViewSymbol(sel: {
  symbol: string;
  market: Market;
}): string {
  const raw = sel.symbol.toUpperCase().replace("/", "");
  if (raw.includes(":")) return raw;
  if (sel.market === "CRYPTO") return `BINANCE:${raw}`;
  return `OANDA:${raw}`;
}

export function tradingViewInterval(timeframe: Timeframe): string {
  if (timeframe === "15m") return "15";
  if (timeframe === "1h") return "60";
  if (timeframe === "4h") return "240";
  if (timeframe === "1d") return "D";
  if (timeframe === "1w") return "W";
  return "M";
}

export function tradingViewUrl(sel: TradingViewSelection): string {
  const symbol = encodeURIComponent(tradingViewSymbol(sel));
  return `https://www.tradingview.com/chart/?symbol=${symbol}&interval=${tradingViewInterval(sel.timeframe)}`;
}
