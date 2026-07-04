import type { Prisma } from "@/generated/prisma";
import type { SystemCheckSnapshot } from "@/lib/trading-systems/schema";

type DecimalLike = { toString(): string } | number | null | undefined;

/** Convert a Prisma Decimal (or null) to JS number (or null) for JSON. */
export function decToNum(v: DecimalLike): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

export type SerializedTrade = {
  id: string;
  userId: string;
  accountId: string | null;
  strategyId: string | null;
  tradingSystemId: string | null;

  symbol: string;
  market: string;
  direction: string;
  status: string;
  timeframe: string | null;

  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lotSize: number | null;
  riskAmount: number | null;
  rMultiple: number | null;
  pnl: number | null;
  feesAmount: number | null;

  openedAt: string;
  closedAt: string | null;

  setup: string | null;
  notes: string | null;
  mistakes: string | null;
  emotion: string | null;

  systemChecks: SystemCheckSnapshot[] | null;

  createdAt: string;
  updatedAt: string;
};

type TradeRow = {
  id: string;
  userId: string;
  accountId: string | null;
  strategyId: string | null;
  tradingSystemId: string | null;
  symbol: string;
  market: string;
  direction: string;
  status: string;
  timeframe: string | null;
  entryPrice: Prisma.Decimal;
  exitPrice: Prisma.Decimal | null;
  stopLoss: Prisma.Decimal | null;
  takeProfit: Prisma.Decimal | null;
  lotSize: Prisma.Decimal;
  riskAmount: Prisma.Decimal | null;
  rMultiple: Prisma.Decimal | null;
  pnl: Prisma.Decimal | null;
  feesAmount: Prisma.Decimal | null;
  openedAt: Date;
  closedAt: Date | null;
  setup: string | null;
  notes: string | null;
  mistakes: string | null;
  emotion: string | null;
  systemChecks: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Defensive JSON unwrap — JSON columns are `unknown`-shaped at the DB layer.
 * We accept anything resembling our snapshot shape and drop bad rows rather
 * than throwing (history reads should never break the UI).
 */
function parseSystemChecks(value: Prisma.JsonValue | null): SystemCheckSnapshot[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const out: SystemCheckSnapshot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.label !== "string") continue;
    out.push({
      label: e.label,
      required: Boolean(e.required),
      checked: Boolean(e.checked),
    });
  }
  return out.length > 0 ? out : null;
}

export function serializeTrade(t: TradeRow): SerializedTrade {
  return {
    id: t.id,
    userId: t.userId,
    accountId: t.accountId,
    strategyId: t.strategyId,
    tradingSystemId: t.tradingSystemId,
    symbol: t.symbol,
    market: t.market,
    direction: t.direction,
    status: t.status,
    timeframe: t.timeframe,
    entryPrice: decToNum(t.entryPrice),
    exitPrice: decToNum(t.exitPrice),
    stopLoss: decToNum(t.stopLoss),
    takeProfit: decToNum(t.takeProfit),
    lotSize: decToNum(t.lotSize),
    riskAmount: decToNum(t.riskAmount),
    rMultiple: decToNum(t.rMultiple),
    pnl: decToNum(t.pnl),
    feesAmount: decToNum(t.feesAmount),
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    setup: t.setup,
    notes: t.notes,
    mistakes: t.mistakes,
    emotion: t.emotion,
    systemChecks: parseSystemChecks(t.systemChecks),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
