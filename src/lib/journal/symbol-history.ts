/**
 * "Your own history with this symbol" — the strip shown on the calculator and
 * the new-trade form the moment a symbol is filled in.
 *
 * The journal already knows how the user has done on EURUSD; nobody ever sees
 * it while deciding to take the next EURUSD trade. This reads that back as
 * plain facts. It states what happened and stops there — no verdict, no
 * suggestion about the trade being sized.
 *
 * Honesty rules, same as the rest of the journal aggregates:
 *  - P&L and R are user-entered and often missing, so every average carries
 *    its own denominator (`withPnl`, `withR`) instead of counting a missing
 *    number as 0. A trade with no P/L is not a loss.
 *  - Every query is scoped by userId. This is one user's own data, never a
 *    community average.
 */

import "server-only";
import { db } from "@/lib/db";
import { decToNum } from "@/lib/journal/serialize";

/** Enough of a tail to recognise, short enough to sit under one line of stats. */
const RECENT_LIMIT = 5;

export type SymbolHistoryTrade = {
  id: string;
  direction: string;
  openedAt: string;
  closedAt: string | null;
  /** null when the user never recorded a result — shown as "—", never as 0. */
  pnl: number | null;
  rMultiple: number | null;
};

export type SymbolHistory = {
  /** Normalized symbol the numbers below belong to. */
  symbol: string;
  /** Currency of the user's first trading account — P/L is stored in it. */
  currency: string;
  closedTrades: number;
  openTrades: number;
  /** Closed trades carrying a P/L — the denominator for wins/losses/totalPnl. */
  withPnl: number;
  wins: number;
  losses: number;
  breakEven: number;
  /** null when no closed trade on this symbol has a P/L recorded. */
  totalPnl: number | null;
  /** Closed trades carrying an R — the denominator for avgR. */
  withR: number;
  avgR: number | null;
  /** Most recently closed first. */
  recent: SymbolHistoryTrade[];
};

/**
 * Journal rows are stored upper-cased (see the upsert schema), and a symbol can
 * reach us from a combobox, a deep link or free typing — so fold the display
 * form "EUR/USD" onto the stored "EURUSD" before matching.
 */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\//g, "");
}

export async function getSymbolHistory(
  userId: string,
  rawSymbol: string,
): Promise<SymbolHistory> {
  const symbol = normalizeSymbol(rawSymbol);

  const [closed, openTrades, account] = await Promise.all([
    db.tradeJournal.findMany({
      where: { userId, symbol, status: "CLOSED" },
      select: {
        id: true,
        direction: true,
        openedAt: true,
        closedAt: true,
        pnl: true,
        rMultiple: true,
      },
      // Newest first: `recent` is just the head of this list. The aggregates
      // below are order-independent.
      orderBy: [{ closedAt: "desc" }, { openedAt: "desc" }],
    }),
    db.tradeJournal.count({ where: { userId, symbol, status: "OPEN" } }),
    db.tradingAccount.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { currency: true },
    }),
  ]);

  let withPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakEven = 0;
  let pnlSum = 0;
  let withR = 0;
  let rSum = 0;

  for (const t of closed) {
    const pnl = decToNum(t.pnl);
    if (pnl !== null) {
      withPnl += 1;
      pnlSum += pnl;
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
      else breakEven += 1;
    }
    const r = decToNum(t.rMultiple);
    if (r !== null) {
      withR += 1;
      rSum += r;
    }
  }

  return {
    symbol,
    currency: account?.currency ?? "USD",
    closedTrades: closed.length,
    openTrades,
    withPnl,
    wins,
    losses,
    breakEven,
    totalPnl: withPnl > 0 ? Number(pnlSum.toFixed(4)) : null,
    withR,
    avgR: withR > 0 ? Number((rSum / withR).toFixed(4)) : null,
    recent: closed.slice(0, RECENT_LIMIT).map((t) => ({
      id: t.id,
      direction: t.direction,
      openedAt: t.openedAt.toISOString(),
      closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      pnl: decToNum(t.pnl),
      rMultiple: decToNum(t.rMultiple),
    })),
  };
}
