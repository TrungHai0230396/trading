/**
 * OHLCV bar fetcher — full open/high/low/close/volume, parallel to the
 * closes-only `getCandles` in candles.ts.
 *
 * Separate from candles.ts because:
 *  - Most scanner paths only need closes (RSI/EMA/WMA work on closes).
 *  - ATR + volume analysis need high/low/volume too.
 *  - Splitting keeps the scanner hot path lean while making it possible
 *    for the analysis page to ask for the full bar shape.
 *
 * Cache policy: never Next's fetch cache — same reasoning as candles.ts.
 * Stale candles lead to stale trade plans which silently lie to the user.
 * The Binance side shares candles.ts's kline fetch, so it inherits the
 * egress guard (short in-process TTL, coalescing, 429/418 breaker, pacing)
 * and reuses the SAME cache entry the scanner already paid for.
 */

import { findForexPair, tdSymbol } from "@/lib/calc/forex-pairs";
import {
  CandleFetchError,
  fetchBinanceKlines,
  toCandleFetchError,
  type Market,
  type Timeframe,
} from "./candles";
import type { BinancePriority } from "@/lib/net/binance-guard";

export type OHLCVBar = {
  /** Open time in ms since epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Quote-asset volume (e.g. USDT for BTCUSDT). 0 if unavailable (FX). */
  v: number;
};

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
  "1M": "1M",
};

const TWELVEDATA_INTERVAL: Record<Timeframe, string> = {
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
  "1M": "1month",
};

export async function getOHLCV(opts: {
  market: Market;
  symbol: string;
  timeframe: Timeframe;
  limit?: number;
  /** Lets background callers skip the interactive queue — see the guard. */
  priority?: BinancePriority;
}): Promise<OHLCVBar[]> {
  const limit = Math.max(50, Math.min(1000, opts.limit ?? 200));
  if (opts.market === "CRYPTO") {
    return getBinanceOHLCV(opts.symbol, opts.timeframe, limit, opts.priority);
  }
  return getTwelveDataOHLCV(opts.symbol, opts.timeframe, limit);
}

async function getBinanceOHLCV(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  priority?: BinancePriority,
): Promise<OHLCVBar[]> {
  const sym = symbol.toUpperCase().replace("/", "");
  const interval = BINANCE_INTERVAL[timeframe];

  let raw: unknown;
  try {
    raw = await fetchBinanceKlines({ sym, interval, limit, priority });
  } catch (e) {
    throw toCandleFetchError(e, sym, interval);
  }

  if (!Array.isArray(raw)) {
    throw new CandleFetchError("Binance trả về dữ liệu không hợp lệ.");
  }

  // Binance kline schema:
  //   [openTime, open, high, low, close, volume, closeTime,
  //    quoteAssetVolume, ...]
  // Index 7 = quoteAssetVolume (in USDT for *USDT pairs) — that's what
  // we want for "volume in dollars" comparisons.
  const out: OHLCVBar[] = [];
  for (const k of raw) {
    if (!Array.isArray(k) || k.length < 8) continue;
    const t = Number(k[0]);
    const o = Number(k[1]);
    const h = Number(k[2]);
    const l = Number(k[3]);
    const c = Number(k[4]);
    const v = Number(k[7]);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    out.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  if (out.length === 0) {
    throw new CandleFetchError(
      `Binance không trả về nến cho ${sym} ${interval}.`,
    );
  }
  return out;
}

async function getTwelveDataOHLCV(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<OHLCVBar[]> {
  const pair = findForexPair(symbol);
  const tdSym = pair ? pair.display : tdSymbol(symbol);
  const tdInterval = TWELVEDATA_INTERVAL[timeframe];

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    throw new CandleFetchError(
      "Thiếu TWELVE_DATA_API_KEY. Bổ sung vào .env hoặc qua trang Cài đặt.",
    );
  }

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", tdSym);
  url.searchParams.set("interval", tdInterval);
  url.searchParams.set("outputsize", String(limit));
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new CandleFetchError(
      `Twelve Data lỗi HTTP ${res.status} khi tải ${tdSym} ${tdInterval}.`,
      res.status,
    );
  }

  const data = (await res.json()) as
    | {
        status?: string;
        values?: {
          open: string;
          high: string;
          low: string;
          close: string;
          datetime: string;
        }[];
      }
    | { code: number; message: string; status: string };

  if ("code" in data) {
    throw new CandleFetchError(`Twelve Data: ${data.message ?? "lỗi"}`);
  }
  const values = data.values;
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new CandleFetchError(
      `Twelve Data không trả về nến cho ${tdSym} ${tdInterval}.`,
    );
  }

  // Twelve Data returns newest-first; reverse to oldest-first to match
  // Binance + scanner expectations.
  const out: OHLCVBar[] = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    const t = Date.parse(v.datetime);
    const o = Number(v.open);
    const h = Number(v.high);
    const l = Number(v.low);
    const c = Number(v.close);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    // Forex has no meaningful retail volume via TD free tier → 0.
    out.push({ t, o, h, l, c, v: 0 });
  }
  if (out.length === 0) {
    throw new CandleFetchError(
      `Twelve Data trả về dữ liệu không hợp lệ cho ${tdSym}.`,
    );
  }
  return out;
}
