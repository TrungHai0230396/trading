/**
 * Broker adapter — one interface over Bitget and Binance USDT-M futures.
 *
 * Creds are loaded once in getBrokerApi() and captured in the returned
 * closure, so callers never see (or type-juggle) the per-broker creds
 * shapes. All return values use the Bitget-shaped types (balance,
 * position, contract spec) that the order route was originally written
 * against — Binance values are mapped in lib/brokers/binance.ts.
 *
 * placeEntry() folds each broker's SL-attach semantics into one contract:
 *   - Bitget: preset SL/TP on the entry order, then a read-back verify.
 *   - Binance: separate closePosition bracket orders after the entry.
 * Both return `slAttached: true | false | null` (null = not requested or
 * verify inconclusive) so the route's PLACED / PLACED_NO_SL decision is
 * broker-agnostic.
 */

import "server-only";
import { loadCreds } from "@/lib/brokers/store";
import * as bitget from "@/lib/brokers/bitget";
import * as binance from "@/lib/brokers/binance";
import { BitgetError } from "@/lib/brokers/bitget";
import { BinanceError } from "@/lib/brokers/binance";

export type TradeBrokerKind = "BITGET" | "BINANCE";

export type PlaceEntryArgs = {
  symbol: string;
  side: "buy" | "sell";
  orderType: "limit" | "market";
  size: string;
  price?: string;
  clientOid: string;
  stopLoss?: string;
  takeProfit?: string;
  marginMode: "isolated" | "crossed";
};

export type PlaceEntryResult = {
  orderId: string;
  raw: unknown;
  slAttached: boolean | null;
  /** false only when a TP was requested but the broker rejected it. */
  tpRejected: boolean;
};

export type BrokerApi = {
  kind: TradeBrokerKind;
  fetchContractSpec(symbol: string): Promise<bitget.BitgetContractSpec | null>;
  getPositionMode(): Promise<"one_way_mode" | "hedge_mode" | "unknown">;
  getAccountBalance(): Promise<bitget.BitgetBalance>;
  getOpenPositions(): Promise<bitget.BitgetPosition[]>;
  getSinglePosition(symbol: string): Promise<{
    hasPosition: boolean;
    leverage: number | null;
    side: "long" | "short" | null;
    size: number;
  }>;
  setLeverage(args: {
    symbol: string;
    leverage: number;
    marginMode: "isolated" | "crossed";
    direction: "LONG" | "SHORT";
  }): Promise<void>;
  placeEntry(args: PlaceEntryArgs): Promise<PlaceEntryResult>;
};

/** Load creds for a broker and return the unified API, or null if not connected. */
export async function getBrokerApi(
  kind: TradeBrokerKind,
  userId: string,
): Promise<BrokerApi | null> {
  if (kind === "BITGET") {
    const creds = await loadCreds<bitget.BitgetCreds>(userId, "BITGET");
    if (!creds) return null;
    return {
      kind,
      fetchContractSpec: (s) => bitget.fetchContractSpec(s),
      getPositionMode: () => bitget.getPositionMode(creds),
      getAccountBalance: () => bitget.getAccountBalance(creds),
      getOpenPositions: () => bitget.getOpenPositions(creds),
      getSinglePosition: (s) => bitget.getSinglePosition(creds, s),
      setLeverage: (a) =>
        bitget.setLeverage(creds, {
          symbol: a.symbol,
          leverage: a.leverage,
          marginCoin: "USDT",
          productType: "USDT-FUTURES",
          ...(a.marginMode === "isolated"
            ? { holdSide: a.direction === "LONG" ? "long" : "short" }
            : {}),
        }),
      placeEntry: async (a) => {
        const placed = await bitget.placeOrder(creds, {
          symbol: a.symbol,
          productType: "USDT-FUTURES",
          marginCoin: "USDT",
          marginMode: a.marginMode,
          side: a.side,
          orderType: a.orderType,
          size: a.size,
          price: a.price,
          clientOid: a.clientOid,
          presetStopLossPrice: a.stopLoss,
          presetStopSurplusPrice: a.takeProfit,
        });
        // Verify the preset SL actually registered (Bitget can accept the
        // entry while silently dropping an invalid preset).
        let slAttached: boolean | null = null;
        if (a.stopLoss) {
          try {
            const detail = await bitget.getOrderDetail(creds, {
              symbol: a.symbol,
              orderId: placed.result.orderId,
            });
            slAttached = !!detail?.presetStopLossPrice;
          } catch {
            slAttached = null; // network blip — reconciler will check
          }
        }
        // Bitget presets TP on the entry; a dropped TP surfaces the same
        // way as SL. Verify only when requested.
        let tpRejected = false;
        if (a.takeProfit && slAttached !== null) {
          try {
            const detail = await bitget.getOrderDetail(creds, {
              symbol: a.symbol,
              orderId: placed.result.orderId,
            });
            tpRejected = !detail?.presetStopSurplusPrice;
          } catch {
            /* leave false — inconclusive; reconciler covers it */
          }
        }
        return {
          orderId: placed.result.orderId,
          raw: placed.raw,
          slAttached,
          tpRejected,
        };
      },
    };
  }

  const creds = await loadCreds<binance.BinanceCreds>(userId, "BINANCE");
  if (!creds) return null;
  return {
    kind,
    fetchContractSpec: (s) => binance.fetchContractSpec(s),
    getPositionMode: () => binance.getPositionMode(creds),
    getAccountBalance: () => binance.getAccountBalance(creds),
    getOpenPositions: () => binance.getOpenPositions(creds),
    getSinglePosition: (s) => binance.getSinglePosition(creds, s),
    setLeverage: (a) =>
      binance.setLeverage(creds, {
        symbol: a.symbol,
        leverage: a.leverage,
        marginMode: a.marginMode,
      }),
    placeEntry: async (a) => {
      const placed = await binance.placeOrderWithBrackets(creds, {
        symbol: a.symbol,
        side: a.side,
        orderType: a.orderType,
        size: a.size,
        price: a.price,
        clientOid: a.clientOid,
        stopLossPrice: a.stopLoss,
        takeProfitPrice: a.takeProfit,
      });
      return {
        orderId: placed.orderId,
        raw: placed.raw,
        slAttached: a.stopLoss ? (placed.slAttached ?? false) : null,
        tpRejected: a.takeProfit ? placed.tpAttached === false : false,
      };
    },
  };
}

/**
 * Normalize either broker's error into { code, message } with the
 * Vietnamese translation. Returns null for non-broker errors.
 */
export function brokerErrorInfo(
  e: unknown,
): { code: string; message: string } | null {
  if (e instanceof BitgetError) {
    return { code: e.code, message: e.toVietnamese() };
  }
  if (e instanceof BinanceError) {
    return { code: e.code, message: e.toVietnamese() };
  }
  return null;
}

/** True when the error is a definitive business rejection (not a network blip). */
export function isBrokerReject(e: unknown): boolean {
  return e instanceof BitgetError || e instanceof BinanceError;
}
