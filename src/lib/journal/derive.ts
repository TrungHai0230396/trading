import type { MarketType, TradeDirection } from "@/generated/prisma";

/**
 * Derive PnL when status=CLOSED + exitPrice present and the user did not
 * explicitly provide a pnl value.
 *
 * - FOREX: lotSize is in standard lots → 1 lot = 100,000 units of base.
 *   pnl = (exit - entry) * lotSize * 100_000  (× -1 for SHORT)
 * - Other: lotSize is in coin/units.
 *   pnl = (exit - entry) * lotSize  (× -1 for SHORT)
 */
export function derivePnl(args: {
  market: MarketType;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  lotSize: number;
}): number {
  const { market, direction, entryPrice, exitPrice, lotSize } = args;
  const sign = direction === "LONG" ? 1 : -1;
  const multiplier = market === "FOREX" ? 100_000 : 1;
  return (exitPrice - entryPrice) * lotSize * multiplier * sign;
}

export function deriveRMultiple(pnl: number, riskAmount: number): number | null {
  if (!Number.isFinite(pnl) || !Number.isFinite(riskAmount)) return null;
  if (riskAmount <= 0) return null;
  return Number((pnl / riskAmount).toFixed(4));
}
