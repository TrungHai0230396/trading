import type { Prisma } from "@/generated/prisma";

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

  createdAt: string;
  updatedAt: string;
};

type TradeRow = {
  id: string;
  userId: string;
  accountId: string | null;
  strategyId: string | null;
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
  createdAt: Date;
  updatedAt: Date;
};

export function serializeTrade(t: TradeRow): SerializedTrade {
  return {
    id: t.id,
    userId: t.userId,
    accountId: t.accountId,
    strategyId: t.strategyId,
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
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
