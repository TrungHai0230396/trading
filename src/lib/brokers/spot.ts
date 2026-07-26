/**
 * Unified portfolio aggregation (READ-ONLY) — "một nơi quản lý dòng tiền".
 *
 * For every connected broker, pulls BOTH wallets in parallel:
 *   - spot balances, valued in USDT via the exchange's PUBLIC bulk ticker
 *     (one call per exchange, no key, no quota)
 *   - futures account equity (existing signed read used by the broker cards)
 * and returns a per-broker spot/futures breakdown plus grand totals.
 *
 * Per-user in-process cache (60s) + in-flight coalescing: the dashboard
 * polls, and balances/prices don't move enough for a tighter TTL to matter.
 * One section failing (e.g. key lacks spot read scope) degrades to an error
 * string on that section only — everything else still renders.
 */

import "server-only";

import { loadCreds } from "@/lib/brokers/store";
import { getServerPublicIp } from "@/lib/server-ip";
import {
  getSpotAssets,
  getAccountBalance as getBitgetFuturesBalance,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import {
  getSpotBalances,
  getAccountBalance as getBinanceFuturesBalance,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";
import {
  getSpotBalances as getMexcSpotBalances,
  getAccountBalance as getMexcFuturesBalance,
  MexcError,
  type MexcCreds,
} from "@/lib/brokers/mexc";
import {
  getSpotBalances as getOkxSpotBalances,
  getAccountBalance as getOkxFuturesBalance,
  OkxError,
  type OkxCreds,
} from "@/lib/brokers/okx";

export type SpotHolding = {
  coin: string;
  total: number;
  usdValue: number;
};

export type BrokerSpot = {
  broker: "BITGET" | "BINANCE" | "MEXC" | "OKX";
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

export type FuturesSnapshot = {
  /** wallet + unrealized PnL, in the margin coin (USDT) */
  equity: number;
  available: number;
  unrealizedPnl: number;
  error?: string;
};

export type BrokerPortfolio = {
  broker: "BITGET" | "BINANCE" | "MEXC" | "OKX";
  spot: BrokerSpot;
  futures: FuturesSnapshot;
};

export type Portfolio = {
  brokers: BrokerPortfolio[];
  totals: {
    spotUsd: number;
    futuresUsd: number;
    totalUsd: number;
    unrealizedPnl: number;
  };
  fetchedAt: string;
};

const DUST_USD = 1;
const MAX_ASSETS = 10;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; data: Portfolio }>();
// Coalesce concurrent misses: without this, N parallel requests inside the
// same 60s window each fan out to the exchanges (the rate limit allows 20/min,
// which would otherwise defeat the cache entirely).
const inflight = new Map<string, Promise<Portfolio>>();

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

async function mexcTickerMap(): Promise<Map<string, number>> {
  return cachedTickers("mexc", async () => {
    // MEXC spot ticker is a Binance clone: [{symbol,price}], no key needed.
    const res = await fetch("https://api.mexc.com/api/v3/ticker/price", {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Không lấy được bảng giá MEXC (HTTP ${res.status}).`);
    }
    const rows = (await res.json()) as Array<{ symbol: string; price: string }>;
    const map = new Map<string, number>();
    for (const r of rows) {
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0) map.set(r.symbol.toUpperCase(), p);
    }
    return map;
  });
}

async function okxTickerMap(): Promise<Map<string, number>> {
  return cachedTickers("okx", async () => {
    // OKX public spot tickers: instId "BTC-USDT" → normalise to "BTCUSDT".
    const res = await fetch(
      "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
      { signal: AbortSignal.timeout(10_000), cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(`Không lấy được bảng giá OKX (HTTP ${res.status}).`);
    }
    const json = (await res.json()) as {
      code?: string;
      data?: Array<{ instId: string; last: string }>;
    };
    if (json.code && json.code !== "0") {
      throw new Error(`Không lấy được bảng giá OKX (lỗi ${json.code}).`);
    }
    const map = new Map<string, number>();
    for (const r of json.data ?? []) {
      const p = Number(r.last);
      const sym = r.instId.replace(/-/g, "").toUpperCase();
      if (Number.isFinite(p) && p > 0) map.set(sym, p);
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

/**
 * IP-whitelist rejections are self-inflicted and fixable in one minute —
 * IF the user knows which IP to add. Append it to the message so the
 * dashboard error is directly actionable (Bitget 40018; Binance -2015
 * bundles bad-key/IP/permission, where the IP is still the useful lead).
 */
async function withIpHint(msg: string, code: string): Promise<string> {
  if (code !== "40018" && code !== "-2015") return msg;
  const ip = await getServerPublicIp();
  return ip
    ? `${msg} IP hiện tại của máy chủ: ${ip} — thêm IP này vào whitelist của API key rồi lưu lại.`
    : msg;
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
      if (e.code === "40018") {
        return emptyBroker("BITGET", await withIpHint(e.toVietnamese(), e.code));
      }
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
        await withIpHint(
          `${e.toVietnamese()} Kiểm tra key đã bật "Enable Reading" chưa.`,
          e.code,
        ),
      );
    }
    return emptyBroker("BINANCE", errorText(e, "Binance"));
  }
}

async function fetchMexcSpot(creds: MexcCreds): Promise<BrokerSpot> {
  try {
    const [rows, tickers] = await Promise.all([
      getMexcSpotBalances(creds),
      mexcTickerMap(),
    ]);
    return {
      broker: "MEXC",
      ...valueHoldings(
        rows.map((r) => ({ coin: r.asset, total: r.total })),
        tickers,
      ),
    };
  } catch (e) {
    if (e instanceof MexcError) {
      return emptyBroker("MEXC", e.toVietnamese());
    }
    return emptyBroker("MEXC", errorText(e, "MEXC"));
  }
}

async function fetchOkxSpot(creds: OkxCreds): Promise<BrokerSpot> {
  try {
    const [rows, tickers] = await Promise.all([
      getOkxSpotBalances(creds),
      okxTickerMap(),
    ]);
    return {
      broker: "OKX",
      ...valueHoldings(
        rows.map((r) => ({ coin: r.asset, total: r.total })),
        tickers,
      ),
    };
  } catch (e) {
    if (e instanceof OkxError) {
      return emptyBroker("OKX", e.toVietnamese());
    }
    return emptyBroker("OKX", errorText(e, "OKX"));
  }
}

// ─── Futures side ───────────────────────────────────────────────────────

async function fetchBitgetFutures(
  creds: BitgetCreds,
): Promise<FuturesSnapshot> {
  try {
    const b = await getBitgetFuturesBalance(creds);
    return {
      equity: b.equity,
      available: b.available,
      unrealizedPnl: b.unrealizedPnl,
    };
  } catch (e) {
    const error =
      e instanceof BitgetError
        ? await withIpHint(e.toVietnamese(), e.code)
        : errorText(e, "Bitget");
    return { equity: 0, available: 0, unrealizedPnl: 0, error };
  }
}

async function fetchBinanceFutures(
  creds: BinanceCreds,
): Promise<FuturesSnapshot> {
  try {
    const b = await getBinanceFuturesBalance(creds);
    return {
      equity: b.equity,
      available: b.available,
      unrealizedPnl: b.unrealizedPnl,
    };
  } catch (e) {
    const error =
      e instanceof BinanceError
        ? await withIpHint(e.toVietnamese(), e.code)
        : errorText(e, "Binance");
    return { equity: 0, available: 0, unrealizedPnl: 0, error };
  }
}

async function fetchMexcFutures(creds: MexcCreds): Promise<FuturesSnapshot> {
  try {
    const b = await getMexcFuturesBalance(creds);
    return {
      equity: b.equity,
      available: b.available,
      unrealizedPnl: b.unrealizedPnl,
    };
  } catch (e) {
    // Spot-only keys (no Futures permission / not KYC'd) land here — the
    // money total stays correct from spot; this section just notes why the
    // futures wallet is absent.
    const error =
      e instanceof MexcError
        ? `${e.toVietnamese()} (Nếu bạn không dùng Futures MEXC thì bỏ qua thẻ này.)`
        : errorText(e, "MEXC");
    return { equity: 0, available: 0, unrealizedPnl: 0, error };
  }
}

async function fetchOkxFutures(creds: OkxCreds): Promise<FuturesSnapshot> {
  try {
    // OKX is a unified account — equity/available stay 0 to avoid double
    // counting the spot side; we surface the floating PnL only.
    const b = await getOkxFuturesBalance(creds);
    return { equity: b.equity, available: b.available, unrealizedPnl: b.unrealizedPnl };
  } catch (e) {
    const error =
      e instanceof OkxError ? e.toVietnamese() : errorText(e, "OKX");
    return { equity: 0, available: 0, unrealizedPnl: 0, error };
  }
}

// ─── Entry point ────────────────────────────────────────────────────────

/**
 * Drop a user's cached portfolio — called when they connect/disconnect a
 * broker key so the dashboard reflects the change immediately instead of
 * showing "Chưa kết nối sàn nào" (or a ghost broker) for up to 60s.
 */
export function invalidatePortfolio(userId: string): void {
  cache.delete(userId);
  inflight.delete(userId);
}

export async function getPortfolio(userId: string): Promise<Portfolio> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // Concurrent misses share one upstream fetch instead of stampeding.
  const pending = inflight.get(userId);
  if (pending) return pending;

  const job = (async () => {
    const [bitgetCreds, binanceCreds, mexcCreds, okxCreds] = await Promise.all([
      loadCreds<BitgetCreds>(userId, "BITGET"),
      loadCreds<BinanceCreds>(userId, "BINANCE"),
      loadCreds<MexcCreds>(userId, "MEXC"),
      loadCreds<OkxCreds>(userId, "OKX"),
    ]);

    const jobs: Promise<BrokerPortfolio>[] = [];
    if (bitgetCreds) {
      jobs.push(
        Promise.all([
          fetchBitgetSpot(bitgetCreds),
          fetchBitgetFutures(bitgetCreds),
        ]).then(([spot, futures]) => ({ broker: "BITGET" as const, spot, futures })),
      );
    }
    if (binanceCreds) {
      jobs.push(
        Promise.all([
          fetchBinanceSpot(binanceCreds),
          fetchBinanceFutures(binanceCreds),
        ]).then(([spot, futures]) => ({ broker: "BINANCE" as const, spot, futures })),
      );
    }
    if (mexcCreds) {
      jobs.push(
        Promise.all([
          fetchMexcSpot(mexcCreds),
          fetchMexcFutures(mexcCreds),
        ]).then(([spot, futures]) => ({ broker: "MEXC" as const, spot, futures })),
      );
    }
    if (okxCreds) {
      jobs.push(
        Promise.all([
          fetchOkxSpot(okxCreds),
          fetchOkxFutures(okxCreds),
        ]).then(([spot, futures]) => ({ broker: "OKX" as const, spot, futures })),
      );
    }

    const brokers = await Promise.all(jobs);
    // Grand totals skip errored sections (their numbers are zeroed anyway);
    // per-section error strings tell the card what's missing from the sum.
    const spotUsd = brokers.reduce((s, b) => s + b.spot.totalUsd, 0);
    const futuresUsd = brokers.reduce((s, b) => s + b.futures.equity, 0);
    const data: Portfolio = {
      brokers,
      totals: {
        spotUsd,
        futuresUsd,
        totalUsd: spotUsd + futuresUsd,
        unrealizedPnl: brokers.reduce(
          (s, b) => s + b.futures.unrealizedPnl,
          0,
        ),
      },
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
