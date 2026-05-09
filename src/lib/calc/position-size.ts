/**
 * Position-size calculator. Pure functions — no I/O.
 *
 * All forex math is in account currency. Caller is responsible for fetching
 * the quote→account FX rate and passing it in `quoteToAccountRate`.
 *
 *   quoteToAccountRate = how many units of ACCOUNT currency 1 unit of QUOTE
 *   currency is worth right now. If account == quote, pass 1.
 */

import { LOT_UNITS, type ForexPair } from "@/lib/calc/forex-pairs";

export type StopMode = "price" | "pips";
export type RiskMode = "percent" | "fixed";
export type Direction = "LONG" | "SHORT";

export type ForexInput = {
  market: "FOREX";
  accountCurrency: string;
  pair: ForexPair;
  direction: Direction;
  entryPrice: number;
  stopMode: StopMode;
  stopValue: number;            // price or pips
  takeProfitPrice?: number;
  riskMode: RiskMode;
  riskValue: number;            // percent (e.g. 1.5) or fixed amount
  accountBalance?: number;      // required when riskMode = "percent"
  quoteToAccountRate: number;   // 1 if quote == accountCurrency
};

export type CryptoInput = {
  market: "CRYPTO";
  accountCurrency: string;
  symbol: string;
  base: string;
  quote: string;
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  takeProfitPrice?: number;
  riskMode: RiskMode;
  riskValue: number;
  accountBalance?: number;
  /** how many units of account ccy 1 unit of QUOTE is worth, e.g. USDT≈1 USD */
  quoteToAccountRate: number;
};

export type PositionSizeResult = {
  market: "FOREX" | "CRYPTO";
  riskAmount: number;             // in account currency
  stopLossPips?: number;          // FX only
  stopLossDistance: number;       // |entry - sl| in price units
  pipValuePerLotInAccount?: number;  // FX, std lot
  positionSize: {
    units: number;
    standardLots?: number;
    miniLots?: number;
    microLots?: number;
  };
  notional: number;               // entry * units, in quote (or quote*rate for FX→account)
  notionalInAccount: number;
  rrRatio?: number;               // |TP-entry| / |SL-entry|
  takeProfitPips?: number;
  expectedProfit?: number;        // when TP hits, in account
  warnings: string[];
};

const round = (n: number, dp = 2) => {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
};

function resolveRiskAmount(
  riskMode: RiskMode,
  riskValue: number,
  accountBalance: number | undefined,
  warnings: string[],
): number {
  if (riskMode === "fixed") return riskValue;
  if (accountBalance == null || accountBalance <= 0) {
    warnings.push("Cần số dư tài khoản khi tính risk theo %.");
    return 0;
  }
  return (riskValue / 100) * accountBalance;
}

function rrFromPrices(
  direction: Direction,
  entry: number,
  sl: number,
  tp: number | undefined,
): { distance: number; rr?: number; tpDistance?: number } {
  const distance = Math.abs(entry - sl);
  if (tp == null) return { distance };

  // For LONG: SL must be below entry, TP above. Inverted for SHORT.
  // We just use absolute distances — sign correctness is the caller's job.
  const tpDistance = Math.abs(entry - tp);
  return {
    distance,
    rr: distance > 0 ? tpDistance / distance : undefined,
    tpDistance,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Forex
// ──────────────────────────────────────────────────────────────────────────

export function calcForexPosition(input: ForexInput): PositionSizeResult {
  const warnings: string[] = [];
  const { pair, entryPrice, stopMode, stopValue, takeProfitPrice } = input;

  if (entryPrice <= 0) warnings.push("Giá vào lệnh phải dương.");
  if (input.quoteToAccountRate <= 0)
    warnings.push("Tỉ giá quote→account phải dương.");

  // Stop loss in price terms.
  let stopPrice: number;
  let stopLossPips: number;
  if (stopMode === "pips") {
    stopLossPips = stopValue;
    stopPrice =
      input.direction === "LONG"
        ? entryPrice - stopLossPips * pair.pipSize
        : entryPrice + stopLossPips * pair.pipSize;
  } else {
    stopPrice = stopValue;
    stopLossPips = Math.abs(entryPrice - stopPrice) / pair.pipSize;
  }

  const { distance, rr, tpDistance } = rrFromPrices(
    input.direction,
    entryPrice,
    stopPrice,
    takeProfitPrice,
  );

  // Pip value per standard lot in QUOTE currency = pipSize * contractSize.
  const pipValuePerStdLotQuote = pair.pipSize * LOT_UNITS.standard;
  const pipValuePerStdLotAccount =
    pipValuePerStdLotQuote * input.quoteToAccountRate;

  const riskAmount = resolveRiskAmount(
    input.riskMode,
    input.riskValue,
    input.accountBalance,
    warnings,
  );

  // Lots = riskAmount / (pips * pip value per std lot in account).
  let standardLots = 0;
  if (stopLossPips > 0 && pipValuePerStdLotAccount > 0) {
    standardLots = riskAmount / (stopLossPips * pipValuePerStdLotAccount);
  } else if (stopLossPips === 0) {
    warnings.push("Khoảng cách stop loss bằng 0.");
  }

  const units = standardLots * LOT_UNITS.standard;
  const notionalInQuote = units * entryPrice;
  const notionalInAccount = notionalInQuote * input.quoteToAccountRate;

  let takeProfitPips: number | undefined;
  let expectedProfit: number | undefined;
  if (tpDistance != null) {
    takeProfitPips = tpDistance / pair.pipSize;
    expectedProfit = takeProfitPips * standardLots * pipValuePerStdLotAccount;
  }

  return {
    market: "FOREX",
    riskAmount: round(riskAmount, 2),
    stopLossPips: round(stopLossPips, 1),
    stopLossDistance: round(distance, pair.digits),
    pipValuePerLotInAccount: round(pipValuePerStdLotAccount, 4),
    positionSize: {
      units: round(units, 2),
      standardLots: round(standardLots, 4),
      miniLots: round(standardLots * 10, 3),
      microLots: round(standardLots * 100, 2),
    },
    notional: round(notionalInQuote, 2),
    notionalInAccount: round(notionalInAccount, 2),
    rrRatio: rr ? round(rr, 2) : undefined,
    takeProfitPips: takeProfitPips ? round(takeProfitPips, 1) : undefined,
    expectedProfit:
      expectedProfit != null ? round(expectedProfit, 2) : undefined,
    warnings,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Crypto
// ──────────────────────────────────────────────────────────────────────────

export function calcCryptoPosition(input: CryptoInput): PositionSizeResult {
  const warnings: string[] = [];
  const { entryPrice, stopPrice, takeProfitPrice } = input;

  if (entryPrice <= 0) warnings.push("Giá vào lệnh phải dương.");
  if (input.quoteToAccountRate <= 0)
    warnings.push("Tỉ giá quote→account phải dương.");

  const { distance, rr, tpDistance } = rrFromPrices(
    input.direction,
    entryPrice,
    stopPrice,
    takeProfitPrice,
  );

  const riskAmount = resolveRiskAmount(
    input.riskMode,
    input.riskValue,
    input.accountBalance,
    warnings,
  );

  // For crypto: position size in BASE units.
  // riskAmountInQuote = riskAmount / quoteToAccountRate
  // units = riskAmountInQuote / |entry - sl|
  const riskAmountInQuote = riskAmount / input.quoteToAccountRate;
  let units = 0;
  if (distance > 0 && riskAmountInQuote > 0) {
    units = riskAmountInQuote / distance;
  } else if (distance === 0) {
    warnings.push("Khoảng cách stop loss bằng 0.");
  }

  const notionalInQuote = units * entryPrice;
  const notionalInAccount = notionalInQuote * input.quoteToAccountRate;

  let expectedProfit: number | undefined;
  if (tpDistance != null) {
    expectedProfit = tpDistance * units * input.quoteToAccountRate;
  }

  return {
    market: "CRYPTO",
    riskAmount: round(riskAmount, 2),
    stopLossDistance: round(distance, 8),
    positionSize: {
      units: round(units, 8),
    },
    notional: round(notionalInQuote, 2),
    notionalInAccount: round(notionalInAccount, 2),
    rrRatio: rr ? round(rr, 2) : undefined,
    expectedProfit:
      expectedProfit != null ? round(expectedProfit, 2) : undefined,
    warnings,
  };
}
