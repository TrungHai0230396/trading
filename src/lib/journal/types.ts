import type { SystemCheckSnapshot } from "@/lib/trading-systems/schema";

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

export type TradeDetail = SerializedTrade & {
  screenshots: { id: string; url: string; caption: string | null; kind: string | null; createdAt: string }[];
  tags: { id: string; name: string; color: string | null }[];
  strategy: { id: string; name: string } | null;
  account: { id: string; name: string; currency: string } | null;
  tradingSystem: { id: string; name: string } | null;
};

export type JournalStats = {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winRate: number;
  avgR: number;
  totalPnl: number;
  currency: string;
};

export type TradeListResponse = {
  items: SerializedTrade[];
  nextCursor: string | null;
};
