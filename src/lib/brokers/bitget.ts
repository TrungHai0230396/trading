/**
 * Bitget V2 API client — read-only (Phase 1).
 *
 * Authentication: 4 headers (ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP,
 * ACCESS-PASSPHRASE). Signature is HMAC-SHA256 over
 *   `timestamp + method.toUpperCase() + requestPath + body`
 * with the secret key, output base64.
 *
 * For GET requests, requestPath INCLUDES the query string and body is "".
 *
 * V2 docs: https://www.bitget.com/api-doc/contract/account/Get-Account-Information
 */

import "server-only";
import crypto from "node:crypto";

const BASE = "https://api.bitget.com";

export type BitgetCreds = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

export type BitgetBalance = {
  marginCoin: string;
  equity: number;
  available: number;
  used: number;
  unrealizedPnl: number;
};

export type BitgetPosition = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnl: number;
  marginMode: "isolated" | "crossed";
};

export class BitgetError extends Error {
  /**
   * Verbatim message Bitget returned (`msg` field). Stored separately from
   * `message` because we sometimes overwrite the latter with our own
   * Vietnamese translation, and the original is needed for debugging
   * when the translation turns out to be wrong.
   */
  public bitgetMsg?: string;
  constructor(
    public code: string,
    message: string,
    bitgetMsg?: string,
  ) {
    super(message);
    this.name = "BitgetError";
    this.bitgetMsg = bitgetMsg ?? message;
  }
  /**
   * Map known Bitget error codes to friendly Vietnamese messages.
   * Full list: https://www.bitget.com/api-doc/common/codes
   */
  toVietnamese(): string {
    switch (this.code) {
      // Auth / connection
      case "40014":
        return "Sai passphrase. Kiểm tra lại trong Bitget API Management.";
      case "40009":
        return "Chữ ký không hợp lệ — secret key sai hoặc đồng hồ máy lệch.";
      case "40037":
      case "40034":
        return "API key không tồn tại hoặc đã bị xoá.";
      case "40012":
        return "API key không có quyền đọc — bật quyền Read trong Bitget.";
      case "40013":
        return "API key không có quyền giao dịch — bật quyền Trade trong Bitget.";
      case "40018":
        return "IP của server chưa được whitelist trong Bitget.";
      case "40725":
        return "Tài khoản futures chưa được kích hoạt. Vào Bitget mở Futures trước.";
      // Order placement
      case "22002":
      case "43012":
        return "Số dư khả dụng không đủ cho lệnh này.";
      case "40754":
        return "Đòn bẩy ngoài khoảng cho phép cho cặp này.";
      case "40755":
        return "Đòn bẩy vượt mức cho phép theo bậc vị thế hiện tại.";
      case "40760":
        return "Tham số lệnh không hợp lệ.";
      case "40761":
        return "Khối lượng phải là bội số của bước (sizeMultiplier).";
      case "40762":
        return "Giá phải là bội số của tick size.";
      case "40774":
        return "Thiếu hoặc sai tradeSide. Tài khoản phải ở chế độ one-way để đặt tự động.";
      case "40808":
        return "Khối lượng dưới mức tối thiểu cho cặp này.";
      case "40913":
      case "45110":
        return "Chế độ vị thế không khớp (hedge vs one-way). Chuyển về One-way trong Bitget.";
      case "40914":
        return "Không đổi được đòn bẩy khi đang có vị thế mở trên cặp này.";
      case "45116":
      case "45117":
        return "Đòn bẩy vượt mức cho phép theo bậc rủi ro.";
      case "40771":
        return "Vùng/KYC không cho phép giao dịch cặp này.";
      case "40768":
        return "Không tìm thấy lệnh (đã huỷ hoặc đã khớp).";
      default:
        return `Lỗi Bitget (${this.code}): ${this.bitgetMsg ?? this.message}`;
    }
  }
}

function sign(
  timestamp: string,
  method: "GET" | "POST",
  requestPath: string,
  body: string,
  secret: string,
): string {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

async function signedGet<T>(
  creds: BitgetCreds,
  path: string,
  query: Record<string, string> = {},
): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const requestPath = qs ? `${path}?${qs}` : path;
  const timestamp = Date.now().toString();
  const signature = sign(timestamp, "GET", requestPath, "", creds.secret);

  const res = await fetch(`${BASE}${requestPath}`, {
    method: "GET",
    headers: {
      "ACCESS-KEY": creds.apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": creds.passphrase,
      "Content-Type": "application/json",
      locale: "en-US",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    code?: string;
    msg?: string;
    data?: unknown;
  };

  if (!res.ok || json.code !== "00000") {
    const code = json.code ?? String(res.status);
    const rawMsg = json.msg ?? res.statusText;
    throw new BitgetError(code, rawMsg, rawMsg);
  }
  return json.data as T;
}

/**
 * Cheap signed call used to verify creds without pulling full account data.
 *
 * Uses a Futures endpoint so the user only needs to grant **Futures Read**
 * — they do NOT need to tick Spot permission (Bitget bundles Spot Read
 * with Trade, which would be over-privileged for this app).
 *
 * Returns the user ID (if exposed by the response) so the UI can confirm
 * "connected to UID xxx".
 */
export async function testConnection(
  creds: BitgetCreds,
): Promise<
  { ok: true; uid: string } | { ok: false; error: string; code?: string }
> {
  try {
    // Futures account list; minimal data, requires only Futures Read.
    const rows = await signedGet<
      Array<{ marginCoin: string; accountId?: string }>
    >(creds, "/api/v2/mix/account/accounts", { productType: "USDT-FUTURES" });
    // Bitget's mix/accounts response carries accountId on each row.
    const uid = rows[0]?.accountId ?? "—";
    return { ok: true, uid };
  } catch (e) {
    if (e instanceof BitgetError) {
      return { ok: false, error: e.toVietnamese(), code: e.code };
    }
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "Bitget không phản hồi trong 10 giây." };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Lỗi không xác định",
    };
  }
}

export async function getAccountBalance(
  creds: BitgetCreds,
): Promise<BitgetBalance> {
  const rows = await signedGet<
    Array<{
      marginCoin: string;
      // V2 has NO bare `equity` field — the account's worth arrives as
      // accountEquity/usdtEquity. We parsed `equity` (always undefined → 0),
      // so the UI showed "Equity 0.00" next to a non-zero "Khả dụng".
      // Accept all spellings, prefer the documented one.
      accountEquity?: string;
      usdtEquity?: string;
      equity?: string;
      available: string;
      locked: string;
      unrealizedPL: string;
    }>
  >(creds, "/api/v2/mix/account/accounts", { productType: "USDT-FUTURES" });

  const usdt = rows.find((r) => r.marginCoin === "USDT") ?? rows[0];
  if (!usdt) {
    return {
      marginCoin: "USDT",
      equity: 0,
      available: 0,
      used: 0,
      unrealizedPnl: 0,
    };
  }
  // Bitget returns empty string for unset fields on fresh accounts; Number("")
  // is 0 but Number(undefined) is NaN which JSON.stringify turns into null —
  // null then breaks any consumer calling .toFixed(). Normalize all fields
  // to finite numbers here.
  const safe = (v: string | undefined | null): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    marginCoin: usdt.marginCoin,
    equity: safe(usdt.accountEquity ?? usdt.usdtEquity ?? usdt.equity),
    available: safe(usdt.available),
    used: safe(usdt.locked),
    unrealizedPnl: safe(usdt.unrealizedPL),
  };
}


// Public, unsigned market data — used to fetch contract specs for
// step-size / tick / minTradeUSDT normalization. Cached at the route
// layer; this helper just talks to Bitget.
export type BitgetContractSpec = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  /** Smallest increment in base coin (size step). */
  sizeMultiplier: number;
  /** Smallest increment in quote price (tick). */
  priceEndStep: number;
  /** Min order size in base coin. */
  minTradeNum: number;
  /** Min notional value in USDT. */
  minTradeUSDT: number;
  /** For liq-price math. */
  maintainMarginRate: number;
  /** "normal" | "off" | "maintain" — only "normal" trades. */
  symbolStatus: string;
};

export type SetLeverageInput = {
  symbol: string;
  leverage: number;
  marginCoin: string; // "USDT"
  productType: "USDT-FUTURES";
  /** Required when marginMode === "isolated"; "long" | "short". */
  holdSide?: "long" | "short";
};

export type PlaceOrderInput = {
  symbol: string;
  productType: "USDT-FUTURES";
  marginCoin: string; // "USDT"
  marginMode: "isolated" | "crossed";
  /** "buy" → open long; "sell" → open short (one-way mode only). */
  side: "buy" | "sell";
  orderType: "limit" | "market";
  size: string; // base-coin units, post-normalized to sizeMultiplier
  price?: string; // required for limit, omitted for market
  /** Idempotency key. Max ~36 chars per Bitget. */
  clientOid: string;
  /** Preset stop loss (close at this price). String per Bitget. */
  presetStopLossPrice?: string;
  /** Preset take profit. */
  presetStopSurplusPrice?: string;
  /** "GTC" | "IOC" | "FOK" | "post_only" — defaults to GTC server-side. */
  force?: "gtc" | "ioc" | "fok" | "post_only";
};

export type PlaceOrderResponse = {
  orderId: string;
  clientOid: string;
};

/**
 * Closed-position record from Bitget's position-history endpoint. Used by
 * the sync job to fill in journal exit price + PnL after the position
 * actually closes (whether via SL/TP/manual close on Bitget).
 */
export type BitgetClosedPosition = {
  symbol: string;
  holdSide: "long" | "short";
  openAvgPrice: number;
  closeAvgPrice: number;
  /** Realized PnL in USDT, fees included. */
  netProfit: number;
  /** Total fees (open + close, always reported positive here). */
  totalFee: number;
  /** Total funding paid/received over the position's life. */
  totalFunding: number;
  closedAt: Date;
  openedAt: Date;
};

export async function getPositionHistory(
  creds: BitgetCreds,
  args: {
    symbol?: string;
    /** Inclusive lower bound on closedAt. */
    startTime?: Date;
    /** Inclusive upper bound on closedAt. */
    endTime?: Date;
    limit?: number;
  } = {},
): Promise<BitgetClosedPosition[]> {
  const query: Record<string, string> = {
    productType: "USDT-FUTURES",
  };
  if (args.symbol) query.symbol = args.symbol;
  if (args.startTime) query.startTime = String(args.startTime.getTime());
  if (args.endTime) query.endTime = String(args.endTime.getTime());
  query.limit = String(args.limit ?? 20);

  type R = {
    list?: Array<{
      symbol: string;
      holdSide: "long" | "short";
      openAvgPrice: string;
      closeAvgPrice: string;
      netProfit: string;
      openFee?: string;
      closeFee?: string;
      totalFunding?: string;
      utime: string;
      ctime: string;
    }>;
  };
  const data = await signedGet<R>(
    creds,
    "/api/v2/mix/position/history-position",
    query,
  );
  const rows = data.list ?? [];
  const num = (v?: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return rows.map((r) => ({
    symbol: r.symbol,
    holdSide: r.holdSide,
    openAvgPrice: Number(r.openAvgPrice),
    closeAvgPrice: Number(r.closeAvgPrice),
    netProfit: Number(r.netProfit),
    // Bitget reports fees as negative amounts; store the magnitude.
    totalFee: Math.abs(num(r.openFee)) + Math.abs(num(r.closeFee)),
    totalFunding: num(r.totalFunding),
    openedAt: new Date(Number(r.ctime)),
    closedAt: new Date(Number(r.utime)),
  }));
}

/**
 * Read an order back from Bitget. Used to verify the preset SL actually
 * registered after place-order succeeded.
 */
export async function getOrderDetail(
  creds: BitgetCreds,
  args: { symbol: string; orderId?: string; clientOid?: string },
): Promise<{
  orderId: string;
  status: string;
  presetStopLossPrice: string | null;
  presetStopSurplusPrice: string | null;
  /** Average filled price (0 / null if order not yet filled). */
  priceAvg: number | null;
  /** Filled base-coin volume. */
  filledSize: number | null;
  raw: unknown;
} | null> {
  const query: Record<string, string> = {
    symbol: args.symbol,
    productType: "USDT-FUTURES",
  };
  if (args.orderId) query.orderId = args.orderId;
  if (args.clientOid) query.clientOid = args.clientOid;

  try {
    type R = {
      orderId: string;
      state: string;
      presetStopLossPrice?: string;
      presetStopSurplusPrice?: string;
      priceAvg?: string;
      baseVolume?: string;
      accBaseVolume?: string;
    };
    const d = await signedGet<R>(
      creds,
      "/api/v2/mix/order/detail",
      query,
    );
    const numOrNull = (v?: string): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      orderId: d.orderId,
      status: d.state,
      presetStopLossPrice: d.presetStopLossPrice ?? null,
      presetStopSurplusPrice: d.presetStopSurplusPrice ?? null,
      priceAvg: numOrNull(d.priceAvg),
      filledSize: numOrNull(d.accBaseVolume ?? d.baseVolume),
      raw: d,
    };
  } catch (e) {
    if (e instanceof BitgetError && e.code === "40768") return null;
    throw e;
  }
}

export async function getOpenPositions(
  creds: BitgetCreds,
): Promise<BitgetPosition[]> {
  const rows = await signedGet<
    Array<{
      symbol: string;
      holdSide: "long" | "short";
      total: string;
      openPriceAvg: string;
      markPrice: string;
      leverage: string;
      unrealizedPL: string;
      marginMode: "isolated" | "crossed";
    }>
  >(creds, "/api/v2/mix/position/all-position", {
    productType: "USDT-FUTURES",
    marginCoin: "USDT",
  });

  return rows
    .filter((r) => Number(r.total) > 0)
    .map((r) => ({
      symbol: r.symbol,
      side: r.holdSide,
      size: Number(r.total),
      entryPrice: Number(r.openPriceAvg),
      markPrice: Number(r.markPrice),
      leverage: Number(r.leverage),
      unrealizedPnl: Number(r.unrealizedPL),
      marginMode: r.marginMode,
    }));
}

// ──────────────────────────────────────────────────────────────────────
// Spot (READ-ONLY) — balances for the portfolio card. No spot trading
// anywhere in the app; this is the only spot surface.
// ──────────────────────────────────────────────────────────────────────

export type SpotAssetRow = {
  coin: string;
  /** available + frozen + locked */
  total: number;
};

/**
 * Requires the API key to have Spot read scope. Keys created futures-only
 * throw a Bitget permission error — the caller shows a "grant Spot read"
 * hint instead of failing the whole portfolio.
 */
export async function getSpotAssets(
  creds: BitgetCreds,
): Promise<SpotAssetRow[]> {
  const rows = await signedGet<
    Array<{
      coin: string;
      available: string;
      frozen: string;
      locked: string;
    }>
  >(creds, "/api/v2/spot/account/assets");

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return rows
    .map((r) => ({
      coin: r.coin.toUpperCase(),
      total: num(r.available) + num(r.frozen) + num(r.locked),
    }))
    .filter((r) => r.total > 0);
}
