/**
 * Position-size calculator. Pure functions — no I/O.
 *
 * All forex math is in account currency. Caller is responsible for fetching
 * the quote→account FX rate and passing it in `quoteToAccountRate`.
 *
 *   quoteToAccountRate = how many units of ACCOUNT currency 1 unit of QUOTE
 *   currency is worth right now. If account == quote, pass 1.
 */

import { type ForexPair } from "@/lib/calc/forex-pairs";

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

/**
 * Futures-leverage suggestion derived from risk + stop, NOT taken as input.
 *
 * The fundamental idea: in isolated-margin futures the user picks a margin
 * to lock up; loss when SL hits is bounded by that margin. If user wants
 * margin = risk amount and SL = full margin drawdown, the required
 * leverage to control `units` size is:
 *
 *   leverage = notional / margin = (units × entry) / riskAmount
 *           = (riskAmount / stopDistance × entry) / riskAmount
 *           = entry / stopDistance
 *
 * The "safe" variant doubles the margin (risk = 50% of margin) so SL
 * hits at half the liquidation distance — leverage halves.
 */
export type LeverageSuggestion = {
  /** entry / stopDistance — at this leverage SL sits exactly at liquidation. */
  exact: number;
  /**
   * `exact` floored to a whole number — what you'd actually type on an
   * exchange. Never rounded up: any leverage above `exact` drags liquidation
   * INSIDE the stop, so the position is liquidated before the SL can fill.
   */
  rounded: number;
  /** exact / 2 — recommended: SL = ~50% of margin loss, leaves a buffer. */
  safe: number;
  /** Margin (account currency) that, with `exact`, makes loss-on-SL = risk. */
  marginForExact: number;
  /** Margin needed if user uses the `safe` (half) leverage instead. */
  marginForSafe: number;
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
  /** Computed leverage advice for isolated-margin futures. */
  leverage?: LeverageSuggestion;
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

/**
 * Compute the leverage suggestion from notional + risk + entry/stop.
 * See LeverageSuggestion type for the math derivation.
 *
 *   exact      = entry / stopDistance        (margin = riskAmount, SL == liq)
 *   rounded    = floor(exact)                (what you'd actually set)
 *   safe       = exact / 2                   (50% buffer)
 *   marginForExact = riskAmount
 *   marginForSafe  = riskAmount × 2
 *
 * Returns `undefined` when inputs make the math undefined (zero distance,
 * non-positive entry, etc.) — caller falls back to omitting the field.
 */
function computeLeverageSuggestion(
  entry: number,
  stopDistance: number,
  riskAmount: number,
): LeverageSuggestion | undefined {
  if (entry <= 0 || stopDistance <= 0 || !Number.isFinite(entry) ||
      !Number.isFinite(stopDistance)) {
    return undefined;
  }
  const exact = entry / stopDistance;
  if (!Number.isFinite(exact) || exact <= 0) return undefined;
  return {
    exact,
    // Floor, never ceil: rounding up puts liquidation closer than the stop,
    // i.e. the trade is liquidated before the SL can trigger. Flooring only
    // ever adds margin. The 1x clamp is the exchange minimum (and at 1x
    // liquidation is effectively unreachable, so it stays on the safe side).
    rounded: Math.max(1, Math.floor(exact)),
    safe: exact / 2,
    marginForExact: riskAmount,
    marginForSafe: riskAmount * 2,
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
  // pip value per std lot in quote ccy = pip size × lot size (in base
  // units). For FX: 0.0001 × 100,000 = $10/lot. For gold: 0.01 × 100 =
  // $1/lot. For silver: 0.001 × 5,000 = $5/lot.
  const pipValuePerStdLotQuote = pair.pipSize * pair.lotUnits;
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

  const units = standardLots * pair.lotUnits;
  const notionalInQuote = units * entryPrice;
  const notionalInAccount = notionalInQuote * input.quoteToAccountRate;

  // Leverage suggestion derived from price-action inputs (entry/SL +
  // chosen risk). NOT a user input — just a hint for futures sizing.
  const lev = computeLeverageSuggestion(entryPrice, distance, riskAmount);
  const leverage = lev
    ? {
        exact: round(lev.exact, 2),
        rounded: lev.rounded,
        safe: round(lev.safe, 2),
        marginForExact: round(lev.marginForExact, 2),
        marginForSafe: round(lev.marginForSafe, 2),
      }
    : undefined;

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
    leverage,
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

  const lev = computeLeverageSuggestion(entryPrice, distance, riskAmount);
  const leverage = lev
    ? {
        exact: round(lev.exact, 2),
        rounded: lev.rounded,
        safe: round(lev.safe, 2),
        marginForExact: round(lev.marginForExact, 2),
        marginForSafe: round(lev.marginForSafe, 2),
      }
    : undefined;

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
    leverage,
    rrRatio: rr ? round(rr, 2) : undefined,
    expectedProfit:
      expectedProfit != null ? round(expectedProfit, 2) : undefined,
    warnings,
  };
}
