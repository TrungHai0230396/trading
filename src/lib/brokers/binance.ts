/**
 * Binance USDT-M Futures client (fapi).
 *
 * Auth: HMAC-SHA256 hex signature over the urlencoded query/body string,
 * API key in the X-MBX-APIKEY header. Two creds only (no passphrase).
 *
 * Shape parity with lib/brokers/bitget.ts is deliberate — the adapter
 * layer exposes both brokers through one interface, so return types here
 * mirror the Bitget ones (BitgetBalance/BitgetPosition/BitgetContractSpec
 * field names) even where Binance vocabulary differs.
 *
 * Key semantic difference vs Bitget: Binance futures has NO preset SL/TP
 * on the entry order. Stops are separate conditional orders with
 * closePosition=true (STOP_MARKET / TAKE_PROFIT_MARKET) that flatten the
 * whole position when the mark price crosses the trigger.
 */

import "server-only";
import crypto from "node:crypto";

import type {
  BitgetBalance,
  BitgetContractSpec,
  BitgetPosition,
} from "@/lib/brokers/bitget";

const BASE = "https://fapi.binance.com";

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
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("timestamp", String(Date.now()));
  qs.set("recvWindow", "5000");
  const query = qs.toString();
  const signature = sign(query, creds.secret);
  const url = `${BASE}${path}?${query}&signature=${signature}`;

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

// ──────────────────────────────────────────────────────────────────────
// Exchange info (public) — module-cached; specs change rarely
// ──────────────────────────────────────────────────────────────────────

type ExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: Array<{
    filterType: string;
    tickSize?: string;
    stepSize?: string;
    minQty?: string;
    notional?: string;
  }>;
};

let exchangeInfoCache: { at: number; map: Map<string, ExchangeSymbol> } | null =
  null;

export async function fetchContractSpec(
  symbol: string,
): Promise<BitgetContractSpec | null> {
  const now = Date.now();
  if (!exchangeInfoCache || now - exchangeInfoCache.at > 10 * 60_000) {
    const res = await fetch(`${BASE}/fapi/v1/exchangeInfo`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new BinanceError(String(res.status), "Không tải được exchangeInfo");
    }
    const json = (await res.json()) as { symbols?: ExchangeSymbol[] };
    const map = new Map<string, ExchangeSymbol>();
    for (const s of json.symbols ?? []) map.set(s.symbol, s);
    exchangeInfoCache = { at: now, map };
  }
  const s = exchangeInfoCache.map.get(symbol.toUpperCase());
  if (!s) return null;

  const f = (type: string) => s.filters.find((x) => x.filterType === type);
  const tick = Number(f("PRICE_FILTER")?.tickSize ?? "0.01");
  const step = Number(f("LOT_SIZE")?.stepSize ?? "0.001");
  const minQty = Number(f("LOT_SIZE")?.minQty ?? step);
  const minNotional = Number(f("MIN_NOTIONAL")?.notional ?? "5");

  return {
    symbol: s.symbol,
    baseCoin: s.baseAsset,
    quoteCoin: s.quoteAsset,
    sizeMultiplier: step,
    priceEndStep: tick,
    minTradeNum: minQty,
    minTradeUSDT: minNotional,
    // exchangeInfo doesn't expose MMR; 0.5% matches the lowest tier and
    // keeps the liq estimate conservative-ish for small positions.
    maintainMarginRate: 0.005,
    symbolStatus: s.status === "TRADING" ? "normal" : s.status.toLowerCase(),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Account config
// ──────────────────────────────────────────────────────────────────────

export async function getPositionMode(
  creds: BinanceCreds,
): Promise<"one_way_mode" | "hedge_mode" | "unknown"> {
  try {
    const d = await signedRequest<{ dualSidePosition: boolean }>(
      creds,
      "GET",
      "/fapi/v1/positionSide/dual",
    );
    return d.dualSidePosition ? "hedge_mode" : "one_way_mode";
  } catch {
    return "unknown";
  }
}

export async function setLeverage(
  creds: BinanceCreds,
  args: { symbol: string; leverage: number; marginMode: "isolated" | "crossed" },
): Promise<void> {
  // Margin type first; -4046 ("already this type") is benign.
  try {
    await signedRequest(creds, "POST", "/fapi/v1/marginType", {
      symbol: args.symbol,
      marginType: args.marginMode === "isolated" ? "ISOLATED" : "CROSSED",
    });
  } catch (e) {
    if (!(e instanceof BinanceError && e.code === "-4046")) throw e;
  }
  await signedRequest(creds, "POST", "/fapi/v1/leverage", {
    symbol: args.symbol,
    leverage: args.leverage,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Orders
// ──────────────────────────────────────────────────────────────────────

export type BinanceEntryResult = {
  orderId: string;
  clientOid: string;
  /** ids of the closePosition bracket orders (if requested + accepted) */
  slOrderId?: string;
  tpOrderId?: string;
  /** whether the SL bracket landed (undefined when none requested) */
  slAttached?: boolean;
  /** whether the TP bracket landed (undefined when none requested) */
  tpAttached?: boolean;
  raw: unknown;
};

/**
 * Place the entry order and, if SL/TP are given, position-level bracket
 * stops (closePosition=true, MARK_PRICE trigger). Brackets are separate
 * orders on Binance — a bracket failure does NOT undo the entry; the
 * caller surfaces `slAttached=false` so the UI can warn (same semantics
 * as Bitget's PLACED_NO_SL).
 */
export async function placeOrderWithBrackets(
  creds: BinanceCreds,
  input: {
    symbol: string;
    side: "buy" | "sell";
    orderType: "limit" | "market";
    size: string;
    price?: string;
    clientOid: string;
    stopLossPrice?: string;
    takeProfitPrice?: string;
  },
): Promise<BinanceEntryResult> {
  const side = input.side === "buy" ? "BUY" : "SELL";
  const closeSide = input.side === "buy" ? "SELL" : "BUY";

  const entryParams: Record<string, string | number | boolean> = {
    symbol: input.symbol,
    side,
    type: input.orderType === "limit" ? "LIMIT" : "MARKET",
    quantity: input.size,
    newClientOrderId: input.clientOid,
  };
  if (input.orderType === "limit") {
    entryParams.price = input.price ?? "0";
    entryParams.timeInForce = "GTC";
  }

  const entry = await signedRequest<{ orderId: number; clientOrderId: string }>(
    creds,
    "POST",
    "/fapi/v1/order",
    entryParams,
  );

  const result: BinanceEntryResult = {
    orderId: String(entry.orderId),
    clientOid: entry.clientOrderId,
    raw: { entry },
  };

  // Returns { attached, orderId }. A BinanceError is a definitive reject →
  // not attached. Any OTHER error (timeout / socket / 5xx) is ambiguous —
  // the bracket MAY be live, so we re-query open brackets to recover its
  // real orderId (else it becomes an unsweepable orphan closePosition stop
  // that can market-flatten a future unrelated position on this symbol).
  const placeBracket = async (
    type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    stopPrice: string,
    tag: "sl" | "tp",
  ): Promise<{ attached: boolean; orderId: string | null }> => {
    try {
      const b = await signedRequest<{ orderId: number }>(
        creds,
        "POST",
        "/fapi/v1/order",
        {
          symbol: input.symbol,
          side: closeSide,
          type,
          stopPrice,
          closePosition: true,
          workingType: "MARK_PRICE",
          newClientOrderId: `${input.clientOid}_${tag}`.slice(0, 36),
        },
      );
      return { attached: true, orderId: String(b.orderId) };
    } catch (e) {
      if (e instanceof BinanceError) {
        return { attached: false, orderId: null }; // definitive reject
      }
      // Ambiguous — did it land? Ask the exchange.
      try {
        const open = await getOpenBrackets(creds, input.symbol);
        const found = open.find((o) => o.type === type);
        if (found) return { attached: true, orderId: found.orderId };
      } catch {
        /* fall through */
      }
      // Genuinely unknown: report NOT attached (surfaces the warning) but
      // with no orderId — safer than claiming success.
      return { attached: false, orderId: null };
    }
  };

  if (input.stopLossPrice) {
    const r = await placeBracket("STOP_MARKET", input.stopLossPrice, "sl");
    result.slOrderId = r.orderId ?? undefined;
    result.slAttached = r.attached;
  }
  if (input.takeProfitPrice) {
    const r = await placeBracket(
      "TAKE_PROFIT_MARKET",
      input.takeProfitPrice,
      "tp",
    );
    result.tpOrderId = r.orderId ?? undefined;
    result.tpAttached = r.attached;
  }
  result.raw = {
    entry,
    slOrderId: result.slOrderId ?? null,
    tpOrderId: result.tpOrderId ?? null,
  };
  return result;
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

export async function cancelOrder(
  creds: BinanceCreds,
  args: { symbol: string; orderId?: string; clientOid?: string },
): Promise<void> {
  const params: Record<string, string> = { symbol: args.symbol };
  if (args.orderId) params.orderId = args.orderId;
  else if (args.clientOid) params.origClientOrderId = args.clientOid;
  await signedRequest(creds, "DELETE", "/fapi/v1/order", params);
}

/** Open position-level bracket stops for a symbol. */
export async function getOpenBrackets(
  creds: BinanceCreds,
  symbol: string,
): Promise<Array<{ orderId: string; type: string; stopPrice: number }>> {
  const rows = await signedRequest<
    Array<{
      orderId: number;
      type: string;
      closePosition: boolean;
      stopPrice: string;
    }>
  >(creds, "GET", "/fapi/v1/openOrders", { symbol });
  return rows
    .filter(
      (r) =>
        r.closePosition &&
        (r.type === "STOP_MARKET" || r.type === "TAKE_PROFIT_MARKET"),
    )
    .map((r) => ({
      orderId: String(r.orderId),
      type: r.type,
      stopPrice: Number(r.stopPrice),
    }));
}

/**
 * Replace the position-level SL or TP. ORDER MATTERS: place the new stop
 * FIRST, then cancel the old one(s). If the new order is rejected (e.g.
 * -2021 "would immediately trigger", precision), the OLD stop is left
 * untouched — the position never rides unprotected. (Cancel-then-place
 * would strand it on any rejection.) Emulates Bitget's atomic
 * pos_loss/pos_profit replace as closely as a two-call API allows.
 */
export async function replacePositionStop(
  creds: BinanceCreds,
  args: {
    symbol: string;
    positionSide: "long" | "short";
    kind: "sl" | "tp";
    triggerPrice: string;
  },
): Promise<{ orderId: string }> {
  const type = args.kind === "sl" ? "STOP_MARKET" : "TAKE_PROFIT_MARKET";
  const closeSide = args.positionSide === "long" ? "SELL" : "BUY";

  // Snapshot existing brackets BEFORE placing, so we know exactly which to
  // remove afterward (and don't accidentally cancel our own new order).
  const before = (await getOpenBrackets(creds, args.symbol)).filter(
    (x) => x.type === type,
  );

  // Place new first — this is the throwing call. On failure the old stop
  // survives and the error propagates to the caller unchanged.
  const d = await signedRequest<{ orderId: number }>(
    creds,
    "POST",
    "/fapi/v1/order",
    {
      symbol: args.symbol,
      side: closeSide,
      type,
      stopPrice: args.triggerPrice,
      closePosition: true,
      workingType: "MARK_PRICE",
    },
  );
  const newId = String(d.orderId);

  // New stop is live — now retire the previous ones (best-effort).
  for (const b of before) {
    if (b.orderId === newId) continue;
    await cancelOrder(creds, { symbol: args.symbol, orderId: b.orderId }).catch(
      () => {},
    );
  }
  return { orderId: newId };
}

/**
 * Close the open position at market (reduce-only), then sweep leftover
 * closePosition brackets so they don't linger as orphan conditionals.
 */
export async function flashClosePosition(
  creds: BinanceCreds,
  symbol: string,
): Promise<{ orderId?: string } | null> {
  const pos = await getSinglePosition(creds, symbol);
  if (!pos.hasPosition || pos.size <= 0 || !pos.side) return null;
  const d = await signedRequest<{ orderId: number }>(
    creds,
    "POST",
    "/fapi/v1/order",
    {
      symbol,
      side: pos.side === "long" ? "SELL" : "BUY",
      type: "MARKET",
      quantity: String(pos.size),
      reduceOnly: true,
    },
  );
  // Sweep brackets (best-effort).
  try {
    const brackets = await getOpenBrackets(creds, symbol);
    for (const b of brackets) {
      await cancelOrder(creds, { symbol, orderId: b.orderId }).catch(() => {});
    }
  } catch {
    /* non-fatal */
  }
  return { orderId: String(d.orderId) };
}

// ──────────────────────────────────────────────────────────────────────
// Realized-PnL history (sync phase 2)
// ──────────────────────────────────────────────────────────────────────

/**
 * Closing fills + income for a symbol since a timestamp. Used by sync to
 * stamp exitPrice/pnl/fees on the journal once the position is flat.
 *
 * netProfit = Σ realizedPnl + Σ funding − Σ commission (matches Bitget's
 * fee-inclusive netProfit).
 */
export async function getCloseSummary(
  creds: BinanceCreds,
  symbol: string,
  since: Date,
): Promise<{
  exitPrice: number | null;
  netProfit: number;
  totalFee: number;
  totalFunding: number;
  lastFillAt: Date | null;
} | null> {
  const [trades, income] = await Promise.all([
    signedRequest<
      Array<{
        price: string;
        qty: string;
        realizedPnl: string;
        commission: string;
        time: number;
      }>
    >(creds, "GET", "/fapi/v1/userTrades", {
      symbol,
      startTime: since.getTime(),
      limit: 200,
    }),
    signedRequest<
      Array<{ incomeType: string; income: string; time: number }>
    >(creds, "GET", "/fapi/v1/income", {
      symbol,
      startTime: since.getTime(),
      limit: 200,
    }),
  ]);

  const closing = trades.filter((t) => Number(t.realizedPnl) !== 0);
  if (closing.length === 0) return null;

  let qtySum = 0;
  let notionalSum = 0;
  let lastFill = 0;
  for (const t of closing) {
    const q = Number(t.qty);
    qtySum += q;
    notionalSum += q * Number(t.price);
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
  };
}
