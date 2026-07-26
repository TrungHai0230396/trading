/**
 * OKX V5 client — read-only.
 *
 * Auth (private endpoints): 4 headers —
 *   OK-ACCESS-KEY, OK-ACCESS-PASSPHRASE, OK-ACCESS-TIMESTAMP (ISO-8601 ms,
 *   e.g. 2026-07-22T09:08:57.715Z), and OK-ACCESS-SIGN =
 *     Base64( HMAC-SHA256( secret, timestamp + method + requestPath + body ) )
 *   requestPath INCLUDES the query string; body is "" for GET.
 *
 * OKX is a UNIFIED account (spot + derivatives share one balance), so unlike
 * Binance/Bitget/MEXC it has no separate "futures wallet". We therefore expose
 * the account's currency holdings as the SPOT side (that IS the money on OKX)
 * and surface open positions separately — futures "equity" is left 0 so the
 * grand total never double-counts the unified balance.
 *
 * READ-ONLY: balances + positions only. Never places/modifies/cancels orders.
 * Return types mirror the Bitget/Binance ones so shared consumers stay simple.
 */

import "server-only";
import crypto from "node:crypto";

import type { BitgetBalance, BitgetPosition } from "@/lib/brokers/bitget";
import type { SpotAssetRow } from "@/lib/brokers/binance";

const BASE = "https://www.okx.com";

export type OkxCreds = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

export class OkxError extends Error {
  public okxMsg?: string;
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "OkxError";
    this.okxMsg = message;
  }
  toVietnamese(): string {
    switch (this.code) {
      case "50111":
      case "50105":
        return "API key không hợp lệ.";
      case "50113":
        return "Chữ ký không hợp lệ — secret key sai.";
      case "50104":
      case "50116":
        return "Passphrase không đúng. Kiểm tra lại khi tạo API key trên OKX.";
      case "50102":
        return "Đồng hồ máy chủ lệch so với OKX. Thử lại sau vài giây.";
      case "50110":
        return "IP của máy chủ chưa được whitelist trong OKX.";
      case "50114":
        return "API key không có quyền đọc — bật quyền Read trong OKX.";
      case "401":
      case "403":
        return "API key không hợp lệ hoặc thiếu quyền.";
      default:
        return `Lỗi OKX (${this.code}): ${this.okxMsg ?? this.message}`;
    }
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function signedGet<T>(
  creds: OkxCreds,
  requestPath: string,
): Promise<T[]> {
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}GET${requestPath}`;
  const sign = crypto
    .createHmac("sha256", creds.secret)
    .update(prehash)
    .digest("base64");

  const res = await fetch(`${BASE}${requestPath}`, {
    method: "GET",
    headers: {
      "OK-ACCESS-KEY": creds.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": creds.passphrase,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    code?: string;
    msg?: string;
    data?: T[];
  };
  if (!res.ok) {
    throw new OkxError(String(json.code ?? res.status), json.msg ?? res.statusText);
  }
  if (json.code && json.code !== "0") {
    throw new OkxError(json.code, json.msg ?? "Lỗi OKX không xác định");
  }
  return json.data ?? [];
}

// ──────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────

export async function testConnection(
  creds: OkxCreds,
): Promise<{ ok: true; uid: string } | { ok: false; error: string; code?: string }> {
  try {
    await signedGet(creds, "/api/v5/account/balance");
    return { ok: true, uid: "—" };
  } catch (e) {
    if (e instanceof OkxError) {
      return { ok: false, error: e.toVietnamese(), code: e.code };
    }
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "OKX không phản hồi trong 15 giây." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" };
  }
}

type OkxBalanceDetail = {
  ccy: string;
  cashBal: string;
  availBal: string;
  eq: string;
  upl: string;
};

export async function getSpotBalances(creds: OkxCreds): Promise<SpotAssetRow[]> {
  // /api/v5/account/balance returns a single account object whose `details`
  // list the per-currency holdings (unified account). Use CASH fields only
  // (cashBal/availBal) — never `eq`, which folds in derivative floating PnL and
  // would leak that into the spot money total.
  const data = await signedGet<{ details?: OkxBalanceDetail[] }>(
    creds,
    "/api/v5/account/balance",
  );
  const details = data[0]?.details ?? [];
  return details
    .map((d) => ({
      asset: d.ccy.toUpperCase(),
      total: num(d.cashBal) || num(d.availBal),
    }))
    .filter((d) => d.total > 0);
}

/**
 * Futures snapshot. OKX unifies spot+derivatives, so `equity`/`available` are
 * left 0 (the money is already counted on the spot side); we surface the
 * account's floating PnL so the card can show it without double-counting.
 */
export async function getAccountBalance(creds: OkxCreds): Promise<BitgetBalance> {
  const data = await signedGet<{ details?: OkxBalanceDetail[] }>(
    creds,
    "/api/v5/account/balance",
  );
  const details = data[0]?.details ?? [];
  // Each detail's `upl` is in its OWN currency, so summing across currencies
  // would mix units (BTC + USDT). Take only the USDT detail → the floating PnL
  // stays in one ≈USD unit (correct for USDT-margined; coin-margined PnL is
  // simply not shown rather than corrupted).
  const usdt = details.find((d) => d.ccy === "USDT");
  return {
    marginCoin: "USDT",
    equity: 0,
    available: 0,
    used: 0,
    unrealizedPnl: num(usdt?.upl),
  };
}

/** "BTC-USDT-SWAP" / "BTC-USDT-240329" → "BTCUSDT". */
function normalizeInstId(instId: string): string {
  const parts = instId.split("-");
  return `${parts[0] ?? ""}${parts[1] ?? ""}`.toUpperCase();
}

export async function getOpenPositions(creds: OkxCreds): Promise<BitgetPosition[]> {
  const rows = await signedGet<{
    instId: string;
    posSide: string; // long | short | net
    pos: string;
    avgPx: string;
    markPx: string;
    upl: string;
    lever: string;
    notionalUsd: string;
    mgnMode: string; // isolated | cross
  }>(creds, "/api/v5/account/positions");

  return rows
    .filter((r) => num(r.pos) !== 0)
    .map((r) => {
      const posNum = num(r.pos);
      const side: "long" | "short" =
        r.posSide === "short" || (r.posSide === "net" && posNum < 0)
          ? "short"
          : "long";
      const markPrice = num(r.markPx);
      // OKX position size is in contracts; derive the coin amount from the
      // USD notional so the journal shows a coin quantity, not contracts.
      const notional = num(r.notionalUsd);
      const size = markPrice > 0 && notional > 0 ? notional / markPrice : Math.abs(posNum);
      return {
        symbol: normalizeInstId(r.instId),
        side,
        size,
        entryPrice: num(r.avgPx),
        markPrice,
        leverage: num(r.lever),
        unrealizedPnl: num(r.upl), // OKX provides floating PnL directly
        marginMode:
          r.mgnMode === "isolated" ? ("isolated" as const) : ("crossed" as const),
      };
    });
}
