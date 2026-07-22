/**
 * Candle (close-price) fetcher for the multi-timeframe scanner.
 *
 *  - CRYPTO  → Binance public REST (no API key)
 *  - FOREX   → Twelve Data (needs TWELVE_DATA_API_KEY)
 *
 * We DO NOT cache. Next.js stale-while-revalidate would otherwise serve
 * days-old candles after an idle period — see comment in getBinanceCloses.
 *
 * Timeframe convention follows Binance: lowercase `m` is minutes, lowercase
 * `h`/`d`/`w` are hours/days/weeks, capital `M` is months (so "15m" ≠ "1M").
 */

import { findForexPair, tdSymbol } from "@/lib/calc/forex-pairs";
import { sharedBudget } from "@/lib/brokers/rate-limit";

// TwelveData free tier ≈ 8 credits/min, 800/day, billed to the owner's ONE
// shared key. Meter the key globally (7/min, 700/day — one under each ceiling)
// so no single user/scan can drain the daily quota. Bulk forex scanning is
// inherently free-tier-bound anyway; this just fails it predictably instead
// of burning the whole day's allowance. CRYPTO uses Binance (public, free) so
// it is intentionally NOT metered here.
const TD_PER_MINUTE = 7;
const TD_PER_DAY = 700;

export type Market = "FOREX" | "CRYPTO";
export type Timeframe = "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d", "1w", "1M"];

export function isTimeframe(s: string): s is Timeframe {
  return (TIMEFRAMES as string[]).includes(s);
}

export const ALL_TIMEFRAMES: Timeframe[] = TIMEFRAMES;

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "15m": "15 phút",
  "1h": "1 giờ",
  "4h": "4 giờ",
  "1d": "1 ngày",
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

  // Disable Next.js fetch cache entirely. We had `revalidate: 60` before,
  // but Next prod uses stale-while-revalidate: the first request after a
  // long idle gap returns *stale* data (from .next/cache/fetch-cache on
  // disk, potentially days old) while triggering a background refetch.
  // For market data that flips bull/bear hour to hour, that's a fatal UX
  // bug — user sees yesterday's bull list and thinks it's live.
  const res = await fetch(url, { cache: "no-store" });
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
  const tdInterval = TWELVEDATA_INTERVAL[timeframe];
  return fetchTwelveDataCloses(tdSym, tdInterval, limit);
}

async function fetchTwelveDataCloses(
  tdSym: string,
  interval: string,
  limit: number,
): Promise<number[]> {
  if (!sharedBudget("twelvedata", TD_PER_MINUTE, TD_PER_DAY)) {
    throw new CandleFetchError(
      "Đã đạt giới hạn dữ liệu forex chung (Twelve Data) lúc này. Thử lại sau ít phút hoặc dùng khung lớn hơn.",
      429,
    );
  }

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", tdSym);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(limit));
  url.searchParams.set("apikey", twelveDataKey());

  const res = await fetch(url, { cache: "no-store" });
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
