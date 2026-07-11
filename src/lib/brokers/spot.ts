/**
 * Spot portfolio aggregation (READ-ONLY).
 *
 * Pulls spot balances from every connected broker, values them in USDT via
 * each exchange's own PUBLIC bulk-ticker endpoint (one call per exchange,
 * no key, no quota), and returns a per-broker breakdown.
 *
 * Per-user in-process cache (60s): the dashboard polls, and balances/prices
 * don't move enough for a tighter TTL to matter. One broker failing (e.g.
 * key lacks spot read scope) degrades to an error string on that broker
 * only — the other broker still renders.
 */

import "server-only";

import { loadCreds } from "@/lib/brokers/store";
import {
  getSpotAssets,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import {
  getSpotBalances,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";

export type SpotHolding = {
  coin: string;
  total: number;
  usdValue: number;
};

export type BrokerSpot = {
  broker: "BITGET" | "BINANCE";
  /** Sum over ALL priced holdings ≥ $1 (listed + otherUsd bucket). */
  totalUsd: number;
  /** Priced holdings ≥ $1, sorted by value desc, capped at 10. */
  assets: SpotHolding[];
  /** Priced holdings beyond the top-10 cap — kept so the header total
   *  always reconciles with what the card shows. */
  otherCount: number;
  otherUsd: number;
  /** Priced holdings worth < $1, excluded from the list. */
  dustCount: number;
  /** Holdings with no USDT pair on this exchange — can't be valued;
   *  NOT counted as dust (a large unlisted position isn't "bụi"). */
  unpricedCount: number;
  error?: string;
};

export type SpotPortfolio = {
  brokers: BrokerSpot[];
  fetchedAt: string;
};

const DUST_USD = 1;
const MAX_ASSETS = 10;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; data: SpotPortfolio }>();
// Coalesce concurrent misses: without this, N parallel requests inside the
// same 60s window each fan out to the exchanges (the rate limit allows 20/min,
// which would otherwise defeat the cache entirely).
const inflight = new Map<string, Promise<SpotPortfolio>>();

// ─── Public bulk tickers (no key) ───────────────────────────────────────
// Tickers are user-independent — cache them module-wide so many users
// resolving in the same minute share one upstream call per exchange.

const tickerCache = new Map<
  string,
  { at: number; map: Map<string, number> }
>();

async function cachedTickers(
  key: string,
  fetcher: () => Promise<Map<string, number>>,
): Promise<Map<string, number>> {
  const hit = tickerCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.map;
  const map = await fetcher();
  tickerCache.set(key, { at: Date.now(), map });
  return map;
}

async function binanceTickerMap(): Promise<Map<string, number>> {
  return cachedTickers("binance", async () => {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price", {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Không lấy được bảng giá Binance (HTTP ${res.status}).`);
    }
    const rows = (await res.json()) as Array<{
      symbol: string;
      price: string;
    }>;
    const map = new Map<string, number>();
    for (const r of rows) {
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0) map.set(r.symbol, p);
    }
    return map;
  });
}

async function bitgetTickerMap(): Promise<Map<string, number>> {
  return cachedTickers("bitget", async () => {
    const res = await fetch(
      "https://api.bitget.com/api/v2/spot/market/tickers",
      { signal: AbortSignal.timeout(10_000), cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(`Không lấy được bảng giá Bitget (HTTP ${res.status}).`);
    }
    const json = (await res.json()) as {
      code?: string;
      msg?: string;
      data?: Array<{ symbol: string; lastPr: string }>;
    };
    // Bitget reports business errors as HTTP 200 + non-"00000" code (same
    // envelope signedGet guards against). Without this check a throttled/
    // maintenance response would yield an empty map → every coin valued $0
    // → a stocked wallet renders as "empty", cached for a minute.
    if (json.code !== "00000") {
      throw new Error(
        `Không lấy được bảng giá Bitget (lỗi ${json.code ?? "?"}).`,
      );
    }
    const map = new Map<string, number>();
    for (const r of json.data ?? []) {
      const p = Number(r.lastPr);
      if (Number.isFinite(p) && p > 0) map.set(r.symbol.toUpperCase(), p);
    }
    return map;
  });
}

// ─── Valuation ──────────────────────────────────────────────────────────

function valueHoldings(
  rows: Array<{ coin: string; total: number }>,
  tickers: Map<string, number>,
): Omit<BrokerSpot, "broker" | "error"> {
  // USDT is the quote currency itself; other stables resolve via their own
  // USDT pair (USDCUSDT etc). A coin with no USDT pair can't be valued —
  // that's "unpriced", NOT dust (it may be a large position).
  const priced: SpotHolding[] = [];
  let unpricedCount = 0;
  for (const r of rows) {
    const price = r.coin === "USDT" ? 1 : tickers.get(`${r.coin}USDT`);
    if (price === undefined) {
      unpricedCount += 1;
      continue;
    }
    priced.push({ coin: r.coin, total: r.total, usdValue: r.total * price });
  }

  const significant = priced
    .filter((v) => v.usdValue >= DUST_USD)
    .sort((a, b) => b.usdValue - a.usdValue);
  const listed = significant.slice(0, MAX_ASSETS);
  const other = significant.slice(MAX_ASSETS);

  return {
    // Header total = listed rows + the explicit "khác" bucket, so the
    // number shown always reconciles with what the card displays.
    totalUsd: significant.reduce((s, v) => s + v.usdValue, 0),
    assets: listed,
    otherCount: other.length,
    otherUsd: other.reduce((s, v) => s + v.usdValue, 0),
    dustCount: priced.length - significant.length,
    unpricedCount,
  };
}

// ─── Per-broker fetchers ────────────────────────────────────────────────

function emptyBroker(
  broker: BrokerSpot["broker"],
  error: string,
): BrokerSpot {
  return {
    broker,
    totalUsd: 0,
    assets: [],
    otherCount: 0,
    otherUsd: 0,
    dustCount: 0,
    unpricedCount: 0,
    error,
  };
}

function errorText(e: unknown, exchange: string): string {
  if (e instanceof Error && e.name === "TimeoutError") {
    return `${exchange} không phản hồi trong 10 giây.`;
  }
  return e instanceof Error ? e.message : "Lỗi không xác định";
}

async function fetchBitgetSpot(creds: BitgetCreds): Promise<BrokerSpot> {
  try {
    const [rows, tickers] = await Promise.all([
      getSpotAssets(creds),
      bitgetTickerMap(),
    ]);
    return { broker: "BITGET", ...valueHoldings(rows, tickers) };
  } catch (e) {
    if (e instanceof BitgetError) {
      // Futures-only keys land here. Do NOT advise ticking Spot scope:
      // Bitget bundles Spot read with Trade (see testConnection note in
      // bitget.ts), so that advice would push users to over-privilege a
      // key. State the situation and let them decide.
      return emptyBroker(
        "BITGET",
        `${e.toVietnamese()} Key này chưa đọc được ví Spot — Bitget gộp quyền Spot chung với Trade, chỉ cấp thêm nếu bạn chấp nhận; không thì bỏ qua thẻ này.`,
      );
    }
    return emptyBroker("BITGET", errorText(e, "Bitget"));
  }
}

async function fetchBinanceSpot(creds: BinanceCreds): Promise<BrokerSpot> {
  try {
    const [rows, tickers] = await Promise.all([
      getSpotBalances(creds),
      binanceTickerMap(),
    ]);
    return {
      broker: "BINANCE",
      ...valueHoldings(
        rows.map((r) => ({ coin: r.asset, total: r.total })),
        tickers,
      ),
    };
  } catch (e) {
    if (e instanceof BinanceError) {
      return emptyBroker(
        "BINANCE",
        `${e.toVietnamese()} Kiểm tra key đã bật "Enable Reading" chưa.`,
      );
    }
    return emptyBroker("BINANCE", errorText(e, "Binance"));
  }
}

// ─── Entry point ────────────────────────────────────────────────────────

export async function getSpotPortfolio(
  userId: string,
): Promise<SpotPortfolio> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // Concurrent misses share one upstream fetch instead of stampeding.
  const pending = inflight.get(userId);
  if (pending) return pending;

  const job = (async () => {
    const [bitgetCreds, binanceCreds] = await Promise.all([
      loadCreds<BitgetCreds>(userId, "BITGET"),
      loadCreds<BinanceCreds>(userId, "BINANCE"),
    ]);

    const jobs: Promise<BrokerSpot>[] = [];
    if (bitgetCreds) jobs.push(fetchBitgetSpot(bitgetCreds));
    if (binanceCreds) jobs.push(fetchBinanceSpot(binanceCreds));

    const data: SpotPortfolio = {
      brokers: await Promise.all(jobs),
      fetchedAt: new Date().toISOString(),
    };

    cache.set(userId, { at: Date.now(), data });
    // Opportunistic eviction — same pattern as the quote cache.
    if (cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
      }
    }
    return data;
  })();

  inflight.set(userId, job);
  try {
    return await job;
  } finally {
    inflight.delete(userId);
  }
}
