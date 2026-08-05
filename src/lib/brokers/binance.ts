/**
 * Binance USDT-M Futures client (fapi).
 *
 * Auth: HMAC-SHA256 hex signature over the urlencoded query/body string,
 * API key in the X-MBX-APIKEY header. Two creds only (no passphrase).
 *
 * READ-ONLY: balances, positions, order detail (for journal sync) and
 * spot holdings. The app never places, modifies or cancels orders —
 * return types mirror the Bitget ones so shared consumers stay simple.
 */

import "server-only";
import crypto from "node:crypto";

import type { BitgetBalance, BitgetPosition } from "@/lib/brokers/bitget";

const BASE = "https://fapi.binance.com";
// Spot lives on a different host; same key/secret, same HMAC signing.
const SPOT_BASE = "https://api.binance.com";

export type BinanceCreds = {
  apiKey: string;
  secret: string;
};

export class BinanceError extends Error {
  public binanceMsg?: string;
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BinanceError";
    this.binanceMsg = message;
  }
  toVietnamese(): string {
    switch (this.code) {
      case "-2015":
        return "API key không hợp lệ, IP chưa whitelist, hoặc thiếu quyền Futures.";
      case "-1022":
        return "Chữ ký không hợp lệ — secret key sai.";
      case "-1021":
        return "Đồng hồ máy chủ lệch so với Binance. Thử lại sau vài giây.";
      case "-2019":
        return "Số dư ký quỹ không đủ cho lệnh này.";
      case "-1111":
        return "Sai độ chính xác số thập phân (precision) cho cặp này.";
      case "-1121":
        return "Cặp không tồn tại trên Binance Futures.";
      case "-4028":
        return "Đòn bẩy ngoài khoảng cho phép cho cặp này.";
      case "-4046":
        return "Chế độ ký quỹ đã đúng, không cần đổi."; // benign
      case "-4047":
      case "-4048":
        return "Không đổi được chế độ ký quỹ khi đang có vị thế/lệnh treo.";
      case "-4061":
        return "Chế độ vị thế không khớp (hedge vs one-way).";
      case "-2021":
        return "Giá trigger SL/TP nằm sai phía — sẽ khớp ngay lập tức. Kiểm tra lại giá.";
      case "-2022":
        return "Lệnh reduce-only bị từ chối — không có vị thế để đóng.";
      case "-2011":
      case "-2013":
        return "Không tìm thấy lệnh (đã khớp hoặc đã huỷ).";
      case "-4164":
        return "Giá trị lệnh dưới mức tối thiểu 5 USDT (chưa gồm đòn bẩy... theo notional).";
      case "-4131":
        return "Giá thị trường biến động quá nhanh (PERCENT_PRICE) — thử lại.";
      default:
        return `Lỗi Binance (${this.code}): ${this.binanceMsg ?? this.message}`;
    }
  }
}

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signedRequest<T>(
  creds: BinanceCreds,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | boolean> = {},
  base: string = BASE,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("timestamp", String(Date.now()));
  qs.set("recvWindow", "5000");
  const query = qs.toString();
  const signature = sign(query, creds.secret);
  const url = `${base}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": creds.apiKey },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as
    | { code?: number; msg?: string }
    | T;
  if (!res.ok) {
    const err = json as { code?: number; msg?: string };
    throw new BinanceError(
      String(err.code ?? res.status),
      err.msg ?? res.statusText,
    );
  }
  // Binance sometimes returns {code,msg} with HTTP 200 on some endpoints.
  const maybeErr = json as { code?: number; msg?: string };
  if (
    typeof maybeErr.code === "number" &&
    maybeErr.code < 0 &&
    typeof maybeErr.msg === "string"
  ) {
    throw new BinanceError(String(maybeErr.code), maybeErr.msg);
  }
  return json as T;
}

// ──────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────

export async function testConnection(
  creds: BinanceCreds,
): Promise<{ ok: true; uid: string } | { ok: false; error: string; code?: string }> {
  try {
    // v2/balance is the cheapest authenticated futures read.
    await signedRequest<unknown[]>(creds, "GET", "/fapi/v2/balance");
    return { ok: true, uid: "—" }; // Binance has no UID on this endpoint
  } catch (e) {
    if (e instanceof BinanceError) {
      return { ok: false, error: e.toVietnamese(), code: e.code };
    }
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "Binance không phản hồi trong 15 giây." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" };
  }
}

export async function getAccountBalance(
  creds: BinanceCreds,
): Promise<BitgetBalance> {
  const rows = await signedRequest<
    Array<{
      asset: string;
      balance: string;
      crossUnPnl: string;
      availableBalance: string;
    }>
  >(creds, "GET", "/fapi/v2/balance");
  const usdt = rows.find((r) => r.asset === "USDT");
  const safe = (v?: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const wallet = safe(usdt?.balance);
  const upnl = safe(usdt?.crossUnPnl);
  const available = safe(usdt?.availableBalance);
  return {
    marginCoin: "USDT",
    equity: wallet + upnl,
    available,
    used: Math.max(0, wallet - available),
    unrealizedPnl: upnl,
  };
}

export async function getOpenPositions(
  creds: BinanceCreds,
): Promise<BitgetPosition[]> {
  const rows = await signedRequest<
    Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      unRealizedProfit: string;
      leverage: string;
      marginType: string; // "isolated" | "cross"
    }>
  >(creds, "GET", "/fapi/v2/positionRisk");
  return rows
    .filter((r) => Number(r.positionAmt) !== 0)
    .map((r) => ({
      symbol: r.symbol,
      side: Number(r.positionAmt) > 0 ? ("long" as const) : ("short" as const),
      size: Math.abs(Number(r.positionAmt)),
      entryPrice: Number(r.entryPrice),
      markPrice: Number(r.markPrice),
      leverage: Number(r.leverage),
      unrealizedPnl: Number(r.unRealizedProfit),
      marginMode:
        r.marginType?.toLowerCase() === "isolated"
          ? ("isolated" as const)
          : ("crossed" as const),
    }));
}

export async function getSinglePosition(
  creds: BinanceCreds,
  symbol: string,
): Promise<{
  hasPosition: boolean;
  leverage: number | null;
  side: "long" | "short" | null;
  size: number;
}> {
  const rows = await signedRequest<
    Array<{ symbol: string; positionAmt: string; leverage: string }>
  >(creds, "GET", "/fapi/v2/positionRisk", { symbol });
  const live = rows.find((r) => Number(r.positionAmt) !== 0);
  if (!live) return { hasPosition: false, leverage: null, side: null, size: 0 };
  const amt = Number(live.positionAmt);
  return {
    hasPosition: true,
    leverage: Number(live.leverage),
    side: amt > 0 ? "long" : "short",
    size: Math.abs(amt),
  };
}

export async function getOrderDetail(
  creds: BinanceCreds,
  args: { symbol: string; orderId?: string; clientOid?: string },
): Promise<{
  orderId: string;
  status: string; // normalized: live|partially_filled|filled|canceled
  priceAvg: number | null;
  filledSize: number | null;
  raw: unknown;
} | null> {
  const params: Record<string, string> = { symbol: args.symbol };
  if (args.orderId) params.orderId = args.orderId;
  else if (args.clientOid) params.origClientOrderId = args.clientOid;
  try {
    const d = await signedRequest<{
      orderId: number;
      status: string;
      avgPrice: string;
      executedQty: string;
    }>(creds, "GET", "/fapi/v1/order", params);
    const map: Record<string, string> = {
      NEW: "live",
      PARTIALLY_FILLED: "partially_filled",
      FILLED: "filled",
      CANCELED: "canceled",
      EXPIRED: "canceled",
      EXPIRED_IN_MATCH: "canceled",
    };
    const avg = Number(d.avgPrice);
    const qty = Number(d.executedQty);
    return {
      orderId: String(d.orderId),
      status: map[d.status] ?? d.status.toLowerCase(),
      priceAvg: Number.isFinite(avg) && avg > 0 ? avg : null,
      filledSize: Number.isFinite(qty) && qty > 0 ? qty : null,
      raw: d,
    };
  } catch (e) {
    if (e instanceof BinanceError && (e.code === "-2013" || e.code === "-2011")) {
      return null;
    }
    throw e;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Realized-PnL history (sync phase 2)
// ──────────────────────────────────────────────────────────────────────

/**
 * userTrades/income reject a window wider than 7 days (-1127), and Binance
 * keeps nothing older anyway on this path. Clamping here turns "position
 * first seen three weeks ago" from a hard API error into a partial answer —
 * which the caller can detect via `closedQty` instead of trusting a sum that
 * silently misses fills.
 */
export const CLOSE_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Closing fills + income for a symbol since a timestamp. Used by sync to
 * stamp exitPrice/pnl/fees on the journal once the position is flat.
 *
 * netProfit = Σ realizedPnl + Σ funding − Σ commission (matches Bitget's
 * fee-inclusive netProfit).
 *
 * `side` is for hedge-mode accounts, where the same symbol can hold a long
 * and a short at once and only one of them closed: pass it and fills booked
 * to the other side are dropped. One-way accounts report positionSide="BOTH"
 * and are unaffected.
 *
 * CAUTION — these are WINDOW totals, not one trade's result. fapi has no
 * closed-position record, so everything here is summed over whatever fills the
 * window contains. If the user closed, re-entered and closed again between two
 * syncs, the window holds TWO round-trips and `netProfit` is their sum (+40 and
 * −70 → −30), a figure belonging to neither, with a qty-weighted `exitPrice`
 * that was never traded. Nothing in the requested `userTrades` shape can split
 * them: there is no side/buyer field to sign the quantities, and the window
 * opens while the position is already open, so there is no flat anchor to cut
 * on. The caller MUST therefore check `closedQty` against the size it last saw
 * open — in BOTH directions — and treat a mismatch as "no answer" rather than
 * stamping a money figure the exchange never reported.
 */
export async function getCloseSummary(
  creds: BinanceCreds,
  symbol: string,
  since: Date,
  side?: "long" | "short",
): Promise<{
  exitPrice: number | null;
  netProfit: number;
  totalFee: number;
  totalFunding: number;
  lastFillAt: Date | null;
  /** Base-coin volume of the fills that actually realized PnL, i.e. how much
   *  of the position we can see being closed inside the window. Compare it to
   *  the size last seen open: SHORT of it means fills are missing, OVER it
   *  means the window covers more than one round-trip — either way the figures
   *  above describe no single trade. */
  closedQty: number;
} | null> {
  const startTime = Math.max(
    since.getTime(),
    Date.now() - CLOSE_HISTORY_WINDOW_MS,
  );
  const [rawTrades, income] = await Promise.all([
    signedRequest<
      Array<{
        price: string;
        qty: string;
        realizedPnl: string;
        commission: string;
        positionSide?: string; // LONG | SHORT | BOTH
        time: number;
      }>
    >(creds, "GET", "/fapi/v1/userTrades", {
      symbol,
      startTime,
      limit: 200,
    }),
    signedRequest<
      Array<{ incomeType: string; income: string; time: number }>
    >(creds, "GET", "/fapi/v1/income", {
      symbol,
      startTime,
      limit: 200,
    }),
  ]);

  // Drop a fill only when it explicitly belongs to the OTHER side — an
  // absent or "BOTH" positionSide means one-way mode, where every fill counts.
  const other = side === "long" ? "SHORT" : side === "short" ? "LONG" : null;
  const trades = other
    ? rawTrades.filter((t) => t.positionSide !== other)
    : rawTrades;

  const closing = trades.filter((t) => Number(t.realizedPnl) !== 0);
  if (closing.length === 0) return null;

  let qtySum = 0;
  let notionalSum = 0;
  let lastFill = 0;
  for (const t of closing) {
    // A single unparseable field would otherwise make qtySum NaN, and NaN
    // reaches the caller as a "price" it will happily write to the journal.
    const q = Number(t.qty) || 0;
    qtySum += q;
    notionalSum += q * (Number(t.price) || 0);
    if (t.time > lastFill) lastFill = t.time;
  }
  let realized = 0;
  let commission = 0;
  let funding = 0;
  for (const t of trades) {
    realized += Number(t.realizedPnl) || 0;
    commission += Math.abs(Number(t.commission) || 0);
  }
  for (const i of income) {
    if (i.incomeType === "FUNDING_FEE") funding += Number(i.income) || 0;
  }

  return {
    exitPrice: qtySum > 0 ? notionalSum / qtySum : null,
    netProfit: realized + funding - commission,
    totalFee: commission,
    totalFunding: funding,
    lastFillAt: lastFill > 0 ? new Date(lastFill) : null,
    closedQty: qtySum,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Spot (READ-ONLY) — balances for the portfolio card. Uses the spot host;
// needs the key's "Enable Reading" permission (on by default).
// ──────────────────────────────────────────────────────────────────────

export type SpotAssetRow = {
  asset: string;
  /** free + locked */
  total: number;
};

export async function getSpotBalances(
  creds: BinanceCreds,
): Promise<SpotAssetRow[]> {
  const acct = await signedRequest<{
    balances: Array<{ asset: string; free: string; locked: string }>;
  }>(creds, "GET", "/api/v3/account", {}, SPOT_BASE);

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (acct.balances ?? [])
    .map((b) => ({
      asset: b.asset.toUpperCase(),
      total: num(b.free) + num(b.locked),
    }))
    .filter((b) => b.total > 0);
}
