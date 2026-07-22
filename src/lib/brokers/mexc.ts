/**
 * MEXC client — read-only.
 *
 * MEXC has TWO separate APIs with DIFFERENT signing:
 *
 *  - SPOT (api.mexc.com) — a Binance clone: HMAC-SHA256 hex over the
 *    urlencoded query string, key in the `X-MEXC-APIKEY` header,
 *    `timestamp` + `signature` query params. Endpoint: /api/v3/account.
 *
 *  - CONTRACT / futures (contract.mexc.com) — headers ApiKey / Request-Time /
 *    Signature, where Signature = HMAC-SHA256(accessKey + timestamp +
 *    paramString) hex (paramString = sorted "k=v&k=v" for GET, "" when no
 *    params). Endpoints: /api/v1/private/account/assets, /position/open_positions.
 *    MEXC re-opened its futures API on 2026-03-31; it needs a KYC'd key with
 *    Futures permission, so this half degrades gracefully when unavailable.
 *
 * READ-ONLY: balances, positions and spot holdings only. The app never
 * places, modifies or cancels orders. Return types mirror the Bitget/Binance
 * ones so the shared portfolio/dashboard consumers stay simple.
 */

import "server-only";
import crypto from "node:crypto";

import type { BitgetBalance, BitgetPosition } from "@/lib/brokers/bitget";
import type { SpotAssetRow } from "@/lib/brokers/binance";

const SPOT_BASE = "https://api.mexc.com";
const CONTRACT_BASE = "https://contract.mexc.com";

export type MexcCreds = {
  apiKey: string;
  secret: string;
};

export class MexcError extends Error {
  public mexcMsg?: string;
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "MexcError";
    this.mexcMsg = message;
  }
  toVietnamese(): string {
    switch (this.code) {
      case "700001":
      case "10072":
        return "API key không hợp lệ hoặc đã bị xoá.";
      case "700002":
      case "10073":
        return "Chữ ký không hợp lệ — secret key sai.";
      case "700003":
        return "Đồng hồ máy chủ lệch so với MEXC. Thử lại sau vài giây.";
      case "700006":
        return "IP của máy chủ chưa được whitelist trong MEXC.";
      case "700007":
      case "70011":
        return "API key không có quyền đọc phần này — bật quyền tương ứng trong MEXC.";
      case "30004":
        return "Key này chưa có quyền đọc Futures của MEXC (cần KYC + bật quyền Futures).";
      case "401":
      case "403":
        return "API key không hợp lệ hoặc thiếu quyền.";
      default:
        return `Lỗi MEXC (${this.code}): ${this.mexcMsg ?? this.message}`;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Spot signing (Binance-compatible)
// ──────────────────────────────────────────────────────────────────────

async function spotSignedGet<T>(
  creds: MexcCreds,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("timestamp", String(Date.now()));
  qs.set("recvWindow", "5000");
  const query = qs.toString();
  const signature = crypto
    .createHmac("sha256", creds.secret)
    .update(query)
    .digest("hex");
  const url = `${SPOT_BASE}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "X-MEXC-APIKEY": creds.apiKey },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as
    | { code?: number; msg?: string }
    | T;
  if (!res.ok) {
    const err = json as { code?: number; msg?: string };
    throw new MexcError(String(err.code ?? res.status), err.msg ?? res.statusText);
  }
  const maybeErr = json as { code?: number; msg?: string };
  if (typeof maybeErr.code === "number" && maybeErr.code !== 0 && maybeErr.msg) {
    throw new MexcError(String(maybeErr.code), maybeErr.msg);
  }
  return json as T;
}

// ──────────────────────────────────────────────────────────────────────
// Contract (futures) signing
// ──────────────────────────────────────────────────────────────────────

async function contractSignedGet<T>(
  creds: MexcCreds,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const timestamp = String(Date.now());
  // GET paramString = params sorted by key, joined "k=v&k=v" (empty if none).
  const keys = Object.keys(params).sort();
  const paramString = keys.map((k) => `${k}=${params[k]}`).join("&");
  const signature = crypto
    .createHmac("sha256", creds.secret)
    .update(creds.apiKey + timestamp + paramString)
    .digest("hex");

  const url = paramString
    ? `${CONTRACT_BASE}${path}?${paramString}`
    : `${CONTRACT_BASE}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ApiKey: creds.apiKey,
      "Request-Time": timestamp,
      Signature: signature,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    code?: number;
    data?: T;
    message?: string;
    msg?: string;
  };
  if (!res.ok) {
    throw new MexcError(
      String(json.code ?? res.status),
      json.message ?? json.msg ?? res.statusText,
    );
  }
  if (json.success === false || (typeof json.code === "number" && json.code !== 0)) {
    throw new MexcError(
      String(json.code ?? "?"),
      json.message ?? json.msg ?? "Lỗi MEXC không xác định",
    );
  }
  return json.data as T;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ──────────────────────────────────────────────────────────────────────
// Read — connection test + spot
// ──────────────────────────────────────────────────────────────────────

export async function testConnection(
  creds: MexcCreds,
): Promise<{ ok: true; uid: string } | { ok: false; error: string; code?: string }> {
  try {
    // Spot account is the guaranteed authenticated read (every key has it);
    // futures is optional and tested lazily by the portfolio fetcher.
    await spotSignedGet<{ balances?: unknown[] }>(creds, "/api/v3/account");
    return { ok: true, uid: "—" };
  } catch (e) {
    if (e instanceof MexcError) {
      return { ok: false, error: e.toVietnamese(), code: e.code };
    }
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "MEXC không phản hồi trong 15 giây." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" };
  }
}

export async function getSpotBalances(creds: MexcCreds): Promise<SpotAssetRow[]> {
  const acct = await spotSignedGet<{
    balances?: Array<{ asset: string; free: string; locked: string }>;
  }>(creds, "/api/v3/account");
  return (acct.balances ?? [])
    .map((b) => ({
      asset: b.asset.toUpperCase(),
      total: num(b.free) + num(b.locked),
    }))
    .filter((b) => b.total > 0);
}

// ──────────────────────────────────────────────────────────────────────
// Read — futures (contract) balance + positions
// ──────────────────────────────────────────────────────────────────────

export async function getAccountBalance(creds: MexcCreds): Promise<BitgetBalance> {
  const rows = await contractSignedGet<
    Array<{
      currency: string;
      equity: number;
      availableBalance: number;
      unrealized: number;
      positionMargin: number;
    }>
  >(creds, "/api/v1/private/account/assets");
  const usdt = (rows ?? []).find((r) => r.currency === "USDT");
  const equity = num(usdt?.equity);
  const available = num(usdt?.availableBalance);
  return {
    marginCoin: "USDT",
    equity,
    available,
    used: Math.max(0, equity - available),
    unrealizedPnl: num(usdt?.unrealized),
  };
}

/** MEXC contract symbols are "BTC_USDT"; normalise to "BTCUSDT". */
function normalizeContractSymbol(s: string): string {
  return s.replace(/_/g, "").toUpperCase();
}

// Public contract metadata — user-independent, so cache module-wide.
const PUBLIC_TTL_MS = 600_000;
let contractSizeCache: { at: number; map: Map<string, number> } | null = null;
let contractPriceCache: { at: number; map: Map<string, number> } | null = null;

async function contractSizeMap(): Promise<Map<string, number>> {
  if (contractSizeCache && Date.now() - contractSizeCache.at < PUBLIC_TTL_MS) {
    return contractSizeCache.map;
  }
  const res = await fetch(`${CONTRACT_BASE}/api/v1/contract/detail`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const map = new Map<string, number>();
  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ symbol: string; contractSize: number }>;
    };
    for (const c of json.data ?? []) {
      const cs = num(c.contractSize);
      if (cs > 0) map.set(c.symbol, cs);
    }
    // Cache ONLY on success — an HTTP error must not poison the cache with
    // an empty map for the full TTL (would make sizes/PnL wrong until it expires).
    contractSizeCache = { at: Date.now(), map };
  }
  return map;
}

async function contractPriceMap(): Promise<Map<string, number>> {
  if (contractPriceCache && Date.now() - contractPriceCache.at < 60_000) {
    return contractPriceCache.map;
  }
  const res = await fetch(`${CONTRACT_BASE}/api/v1/contract/ticker`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const map = new Map<string, number>();
  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ symbol: string; lastPrice: number; fairPrice?: number }>;
    };
    for (const t of json.data ?? []) {
      const p = num(t.fairPrice) || num(t.lastPrice);
      if (p > 0) map.set(t.symbol, p);
    }
    // Cache ONLY on success (see contractSizeMap) — never poison with empties.
    contractPriceCache = { at: Date.now(), map };
  }
  return map;
}

export async function getOpenPositions(
  creds: MexcCreds,
): Promise<BitgetPosition[]> {
  const rows = await contractSignedGet<
    Array<{
      symbol: string;
      positionType: number; // 1 = long, 2 = short
      holdVol: number;
      holdAvgPrice: number;
      leverage: number;
      state: number; // 1 = holding
    }>
  >(creds, "/api/v1/private/position/open_positions");

  const open = (rows ?? []).filter((r) => num(r.holdVol) > 0);
  if (open.length === 0) return [];

  // Best-effort valuation from public metadata; degrade (raw contracts,
  // no mark/uPnL) rather than throw if either public call fails.
  let sizeMap = new Map<string, number>();
  let priceMap = new Map<string, number>();
  try {
    [sizeMap, priceMap] = await Promise.all([
      contractSizeMap(),
      contractPriceMap(),
    ]);
  } catch {
    /* keep empty maps → degraded mapping below */
  }

  return open.map((r) => {
    const side = r.positionType === 1 ? ("long" as const) : ("short" as const);
    const contractSize = sizeMap.get(r.symbol) ?? 1;
    const size = num(r.holdVol) * contractSize;
    const entryPrice = num(r.holdAvgPrice);
    const markPrice = priceMap.get(r.symbol) ?? entryPrice;
    const dir = side === "long" ? 1 : -1;
    return {
      symbol: normalizeContractSymbol(r.symbol),
      side,
      size,
      entryPrice,
      markPrice,
      leverage: num(r.leverage),
      unrealizedPnl: (markPrice - entryPrice) * size * dir,
      marginMode: "crossed" as const,
    };
  });
}
