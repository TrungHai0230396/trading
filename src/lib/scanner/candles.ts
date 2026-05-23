/**
 * Candle (close-price) fetcher for the multi-timeframe scanner.
 *
 *  - CRYPTO  → Binance public REST (no API key)
 *  - FOREX   → Twelve Data (needs TWELVE_DATA_API_KEY)
 *
 * We cache via fetch's Next.js `revalidate` so repeated scans within a
 * minute reuse the same upstream response.
 *
 * Timeframe convention follows Binance: lowercase `m` is minutes, lowercase
 * `h`/`d`/`w` are hours/days/weeks, capital `M` is months (so "15m" ≠ "1M").
 *
 * Twelve Data has no native 3-day interval, so we synthesize it from daily
 * closes by taking every third bar (close-of-3-days = the third 1d close).
 */

import { findForexPair, tdSymbol } from "@/lib/calc/forex-pairs";

export type Market = "FOREX" | "CRYPTO";
export type Timeframe = "15m" | "1h" | "4h" | "1d" | "3d" | "1w" | "1M";

const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d", "3d", "1w", "1M"];

export function isTimeframe(s: string): s is Timeframe {
  return (TIMEFRAMES as string[]).includes(s);
}

export const ALL_TIMEFRAMES: Timeframe[] = TIMEFRAMES;

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "15m": "15 phút",
  "1h": "1 giờ",
  "4h": "4 giờ",
  "1d": "1 ngày",
  "3d": "3 ngày",
  "1w": "1 tuần",
  "1M": "1 tháng",
};

export class CandleFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CandleFetchError";
  }
}

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "3d": "3d",
  "1w": "1w",
  "1M": "1M",
};

/** Twelve Data interval. `null` means we have to synthesize via aggregation. */
const TWELVEDATA_INTERVAL: Record<Timeframe, string | null> = {
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "3d": null, // Twelve Data has no 3day; we aggregate from 1day.
  "1w": "1week",
  "1M": "1month",
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

/**
 * Synthesize an N-bar timeframe from a finer timeframe by taking the
 * close of every Nth bar. Returns the most recent `limit` synthesized
 * bars in oldest-first order.
 */
function aggregateEveryN(closes: number[], factor: number, limit: number): number[] {
  if (factor <= 1) return closes.slice(-limit);
  const out: number[] = [];
  // closes is oldest-first; take the close at the END of each window of size `factor`.
  // Anchor at the latest bar so the most-recent bar always shows the latest close.
  const startOffset = (closes.length - 1) % factor;
  for (let i = startOffset; i < closes.length; i += factor) {
    out.push(closes[i]);
  }
  return out.slice(-limit);
}

async function getTwelveDataCloses(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<number[]> {
  const pair = findForexPair(symbol);
  const tdSym = pair ? pair.display : tdSymbol(symbol);
  const tdInterval = TWELVEDATA_INTERVAL[timeframe];

  // 3-day FX: pull 3× as many 1day bars and aggregate.
  if (tdInterval === null) {
    if (timeframe === "3d") {
      const dailyLimit = Math.min(1000, limit * 3 + 5);
      const dailyCloses = await fetchTwelveDataCloses(tdSym, "1day", dailyLimit);
      return aggregateEveryN(dailyCloses, 3, limit);
    }
    throw new CandleFetchError(
      `Khung ${timeframe} chưa hỗ trợ cho forex.`,
    );
  }

  return fetchTwelveDataCloses(tdSym, tdInterval, limit);
}

async function fetchTwelveDataCloses(
  tdSym: string,
  interval: string,
  limit: number,
): Promise<number[]> {
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
    const rawMessage = data.message ?? "Twelve Data lỗi không xác định.";
    const normalized = rawMessage.toLowerCase();
    const isLimitError =
      normalized.includes("limit") ||
      normalized.includes("quota") ||
      normalized.includes("usage") ||
      normalized.includes("per minute") ||
      normalized.includes("api call") ||
      normalized.includes("requests");

    if (isLimitError) {
      throw new CandleFetchError(
        "Twelve Data đã giới hạn truy cập intraday. Vui lòng thử lại sau hoặc dùng khung 1D/1W/1M.",
        typeof data.code === "number" ? data.code : undefined,
      );
    }

    throw new CandleFetchError(
      `Twelve Data: ${rawMessage}`,
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
