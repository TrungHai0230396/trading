/**
 * Candle (close-price) fetcher for the multi-timeframe scanner.
 *
 *  - CRYPTO  → Binance public REST (no API key)
 *  - FOREX   → Twelve Data (needs TWELVE_DATA_API_KEY)
 *
 * We cache via fetch's Next.js `revalidate` so repeated scans within a
 * minute reuse the same upstream response.
 */

import { findForexPair, tdSymbol } from "@/lib/calc/forex-pairs";

export type Market = "FOREX" | "CRYPTO";
export type Timeframe = "1h" | "4h" | "1d";

const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d"];

export function isTimeframe(s: string): s is Timeframe {
  return (TIMEFRAMES as string[]).includes(s);
}

export const ALL_TIMEFRAMES: Timeframe[] = TIMEFRAMES;

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1h": "1 giờ",
  "4h": "4 giờ",
  "1d": "1 ngày",
};

export class CandleFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CandleFetchError";
  }
}

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const TWELVEDATA_INTERVAL: Record<Timeframe, string> = {
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

export async function getCandles(opts: {
  market: Market;
  symbol: string;
  timeframe: Timeframe;
  limit?: number;
}): Promise<number[]> {
  const { market, symbol, timeframe } = opts;
  const limit = Math.max(50, Math.min(1000, opts.limit ?? 200));

  if (market === "CRYPTO") return getBinanceCloses(symbol, timeframe, limit);
  return getTwelveDataCloses(symbol, timeframe, limit);
}

// ─── Binance ──────────────────────────────────────────────────────────
async function getBinanceCloses(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<number[]> {
  const sym = symbol.toUpperCase().replace("/", "");
  const interval = BINANCE_INTERVAL[timeframe];
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", sym);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    if (res.status === 400) {
      throw new CandleFetchError(
        `Binance không nhận diện symbol "${sym}".`,
        400,
      );
    }
    throw new CandleFetchError(
      `Binance lỗi HTTP ${res.status} khi tải ${sym} ${interval}.`,
      res.status,
    );
  }

  const raw = (await res.json()) as unknown[];
  if (!Array.isArray(raw)) {
    throw new CandleFetchError("Binance trả về dữ liệu không hợp lệ.");
  }

  const closes: number[] = [];
  for (const kline of raw) {
    if (!Array.isArray(kline) || kline.length < 5) continue;
    const close = Number(kline[4]);
    if (Number.isFinite(close)) closes.push(close);
  }
  if (closes.length === 0) {
    throw new CandleFetchError(
      `Binance không trả về nến cho ${sym} ${interval}.`,
    );
  }
  return closes;
}

// ─── Twelve Data ──────────────────────────────────────────────────────
function twelveDataKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    throw new CandleFetchError(
      "Thiếu TWELVE_DATA_API_KEY. Bổ sung vào .env hoặc qua trang Cài đặt.",
    );
  }
  return key;
}

async function getTwelveDataCloses(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<number[]> {
  const pair = findForexPair(symbol);
  const tdSym = pair ? pair.display : tdSymbol(symbol);
  const interval = TWELVEDATA_INTERVAL[timeframe];

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", tdSym);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(limit));
  url.searchParams.set("apikey", twelveDataKey());

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new CandleFetchError(
      `Twelve Data lỗi HTTP ${res.status} khi tải ${tdSym} ${interval}.`,
      res.status,
    );
  }

  const data = (await res.json()) as
    | { status?: string; values?: { close: string }[] }
    | { code: number; message: string; status: string };

  if ("code" in data) {
    throw new CandleFetchError(
      `Twelve Data: ${data.message}`,
      typeof data.code === "number" ? data.code : undefined,
    );
  }

  const values = data.values;
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new CandleFetchError(
      `Twelve Data không trả về nến cho ${tdSym} ${interval}.`,
    );
  }

  // Twelve Data returns newest-first → reverse to oldest-first.
  const closes: number[] = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const c = Number(values[i].close);
    if (Number.isFinite(c)) closes.push(c);
  }
  if (closes.length === 0) {
    throw new CandleFetchError(
      `Twelve Data trả về dữ liệu không hợp lệ cho ${tdSym}.`,
    );
  }
  return closes;
}
