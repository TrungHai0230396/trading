import type { MarketType, TradeDirection } from "@/generated/prisma";
import { findForexPair } from "@/lib/calc/forex-pairs";

/**
 * Derive PnL when status=CLOSED + exitPrice present and the user did not
 * explicitly provide a pnl value. Result is in USD.
 *
 * - FOREX: lotSize is in standard lots, and units-per-lot depends on the
 *   instrument — 100,000 for currency pairs, 100 oz for XAUUSD, 5,000 oz for
 *   XAGUSD (see src/lib/calc/forex-pairs.ts).
 *   pnl = (exit - entry) * lotSize * pair.lotUnits  (× -1 for SHORT)
 * - Other: lotSize is in coin/units.
 *   pnl = (exit - entry) * lotSize  (× -1 for SHORT)
 *
 * Returns null when we cannot state a FOREX result in USD:
 *   - symbol not in the instrument table (free-typed) → contract size unknown
 *   - pair not quoted in USD (USDJPY, EURGBP…) → profit lands in the quote
 *     currency and converting it needs an FX rate at close time, which we do
 *     not have
 * In a money app refusing to guess is the correct answer: a confidently wrong
 * number is worse than no number. Callers must store/emit null and let the
 * user type the real figure from their broker.
 */
export function derivePnl(args: {
  market: MarketType;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  lotSize: number;
}): number | null {
  const { market, symbol, direction, entryPrice, exitPrice, lotSize } = args;
  const sign = direction === "LONG" ? 1 : -1;

  let multiplier = 1;
  if (market === "FOREX") {
    const pair = findForexPair(symbol);
    if (!pair || pair.quote !== "USD") return null;
    multiplier = pair.lotUnits;
  }

  return (exitPrice - entryPrice) * lotSize * multiplier * sign;
}

export function deriveRMultiple(pnl: number, riskAmount: number): number | null {
  if (!Number.isFinite(pnl) || !Number.isFinite(riskAmount)) return null;
  if (riskAmount <= 0) return null;
  return Number((pnl / riskAmount).toFixed(4));
}
