/**
 * Attribution report for the "Điều gì đang lấy tiền của bạn" page.
 *
 * The journal already collects tags, emotion, mistakes and SL/TP on every
 * trade and never shows any of it back. This module reads that dormant data
 * over CLOSED trades and cuts it three ways (tag / emotion / mistake) plus a
 * few discipline counters that need no market data at all.
 *
 * Two honesty rules run through everything here:
 *  - P&L is user-entered and often missing, so every aggregate carries its own
 *    denominator (`withPnl`, `withR`) instead of silently treating null as 0.
 *  - Nothing is inferred about prices the app never stored. Exit
 *    classification only compares the stored exitPrice against the stored
 *    SL/TP; it never claims what price did afterwards.
 */

import "server-only";
import { db } from "@/lib/db";
import { decToNum } from "@/lib/journal/serialize";

/** Below this many trades a bucket is noise; the UI flags it rather than hiding it. */
export const MIN_SAMPLE = 5;

/** Free-text mistakes can produce a long tail — cap the rendered rows. */
const MAX_GROUPS = 15;

export type GroupStat = {
  label: string;
  /** Closed trades in this bucket. */
  trades: number;
  /** Trades carrying a P/L number — the denominator for winRate and totalPnl. */
  withPnl: number;
  wins: number;
  /** null when no trade in the bucket has a P/L recorded. */
  winRate: number | null;
  totalPnl: number;
  /** Trades carrying an R-multiple — the denominator for avgR. */
  withR: number;
  avgR: number | null;
};

export type GroupBreakdown = {
  rows: GroupStat[];
  /** Buckets dropped by the MAX_GROUPS cap — surfaced as a footnote. */
  hidden: number;
  /** Closed trades with nothing recorded in this field. */
  missing: number;
};

export type ExitClassification = {
  /** Closed trades with an exitPrice AND at least one of SL/TP stored. */
  classified: number;
  /** Closed trades excluded — no exitPrice, or neither SL nor TP stored. */
  unclassified: number;
  hitTp: GroupStat;
  hitSl: GroupStat;
  manual: GroupStat;
};

export type RiskDrift = {
  /** Consecutive closed pairs usable for the comparison. */
  pairs: number;
  afterWin: { count: number; avgRisk: number } | null;
  afterLoss: { count: number; avgRisk: number } | null;
  /** afterLoss/afterWin − 1; null unless both sides have a positive average. */
  driftRatio: number | null;
};

export type AttributionStats = {
  currency: string;
  totalTrades: number;
  closedTrades: number;
  byTag: GroupBreakdown;
  byEmotion: GroupBreakdown;
  byMistake: GroupBreakdown;
  stopDiscipline: { withStop: GroupStat; withoutStop: GroupStat };
  exitClassification: ExitClassification;
  riskDrift: RiskDrift;
};

type Row = {
  direction: string;
  pnl: number | null;
  rMultiple: number | null;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskAmount: number | null;
  tags: string[];
  emotion: string | null;
  mistakes: string | null;
};

type Acc = {
  label: string;
  trades: number;
  withPnl: number;
  wins: number;
  totalPnl: number;
  withR: number;
  rSum: number;
};

function newAcc(label: string): Acc {
  return {
    label,
    trades: 0,
    withPnl: 0,
    wins: 0,
    totalPnl: 0,
    withR: 0,
    rSum: 0,
  };
}

function push(acc: Acc, r: Row): void {
  acc.trades += 1;
  if (r.pnl !== null) {
    acc.withPnl += 1;
    acc.totalPnl += r.pnl;
    if (r.pnl > 0) acc.wins += 1;
  }
  if (r.rMultiple !== null) {
    acc.withR += 1;
    acc.rSum += r.rMultiple;
  }
}

function finalize(acc: Acc): GroupStat {
  return {
    label: acc.label,
    trades: acc.trades,
    withPnl: acc.withPnl,
    wins: acc.wins,
    winRate: acc.withPnl > 0 ? acc.wins / acc.withPnl : null,
    totalPnl: acc.totalPnl,
    withR: acc.withR,
    avgR: acc.withR > 0 ? acc.rSum / acc.withR : null,
  };
}

/**
 * Group key for free text. Trim + collapse whitespace + lowercase is
 * deliberately dumb: "exact match" grouping the user can predict beats clever
 * clustering they cannot audit.
 */
function groupKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Build a breakdown from a per-trade value extractor. Returning an empty array
 * means the trade recorded nothing for this field and counts toward `missing`.
 */
function breakdown(
  rows: Row[],
  valuesOf: (r: Row) => string[],
  sort: (a: GroupStat, b: GroupStat) => number,
): GroupBreakdown {
  const buckets = new Map<string, Acc>();
  let missing = 0;

  for (const r of rows) {
    const values = valuesOf(r);
    if (values.length === 0) {
      missing += 1;
      continue;
    }
    // A trade can carry several tags, so it lands in several buckets — bucket
    // trade counts intentionally sum to more than the closed-trade total.
    const seen = new Set<string>();
    for (const raw of values) {
      const key = groupKey(raw);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      let acc = buckets.get(key);
      if (!acc) {
        // First spelling wins as the display label; later casings fold into it.
        acc = newAcc(raw.trim().replace(/\s+/g, " "));
        buckets.set(key, acc);
      }
      push(acc, r);
    }
    if (seen.size === 0) missing += 1;
  }

  const all = Array.from(buckets.values(), finalize).sort(sort);
  return {
    rows: all.slice(0, MAX_GROUPS),
    hidden: Math.max(0, all.length - MAX_GROUPS),
    missing,
  };
}

/** Most-used first — the natural reading order for tags and emotions. */
function byFrequency(a: GroupStat, b: GroupStat): number {
  if (b.trades !== a.trades) return b.trades - a.trades;
  return a.totalPnl - b.totalPnl;
}

/** Most expensive first; buckets with no P/L at all sink to the bottom. */
function byCost(a: GroupStat, b: GroupStat): number {
  const aBlind = a.withPnl === 0 ? 1 : 0;
  const bBlind = b.withPnl === 0 ? 1 : 0;
  if (aBlind !== bBlind) return aBlind - bBlind;
  if (a.totalPnl !== b.totalPnl) return a.totalPnl - b.totalPnl;
  return b.trades - a.trades;
}

/**
 * A stop is "recorded" only when it is a real price. Manual entries and MT
 * imports without a stop store null, but a stray 0 is not a stop either.
 */
function hasStop(r: Row): boolean {
  return r.stopLoss !== null && r.stopLoss > 0;
}

function hasTarget(r: Row): boolean {
  return r.takeProfit !== null && r.takeProfit > 0;
}

/**
 * Direction-aware, inequality-based. Slippage means an exit never lands exactly
 * on the stored level, so equality would classify almost nothing.
 * TP is tested first: on sane data the two conditions cannot both hold, and if
 * a typo puts SL above TP we would rather over-report targets than stops.
 */
function classifyExit(r: Row): "TP" | "SL" | "MANUAL" | null {
  const exit = r.exitPrice;
  if (exit === null) return null;
  const tp = hasTarget(r) ? r.takeProfit : null;
  const sl = hasStop(r) ? r.stopLoss : null;
  if (tp === null && sl === null) return null;

  if (r.direction === "SHORT") {
    if (tp !== null && exit <= tp) return "TP";
    if (sl !== null && exit >= sl) return "SL";
  } else {
    if (tp !== null && exit >= tp) return "TP";
    if (sl !== null && exit <= sl) return "SL";
  }
  return "MANUAL";
}

function exitClassification(rows: Row[]): ExitClassification {
  const tp = newAcc("Chạm TP");
  const sl = newAcc("Chạm SL");
  const manual = newAcc("Thoát tay");
  let unclassified = 0;

  for (const r of rows) {
    const kind = classifyExit(r);
    if (kind === "TP") push(tp, r);
    else if (kind === "SL") push(sl, r);
    else if (kind === "MANUAL") push(manual, r);
    else unclassified += 1;
  }

  return {
    classified: tp.trades + sl.trades + manual.trades,
    unclassified,
    hitTp: finalize(tp),
    hitSl: finalize(sl),
    manual: finalize(manual),
  };
}

/**
 * Does the size of the next bet change after a loss?
 *
 * `rows` must already be ordered by openedAt. "Previous" is the immediately
 * preceding CLOSED trade in that order — not the previous trade that happens to
 * carry a risk figure — so the chronology stays intact. The CURRENT trade needs
 * riskAmount > 0 (manual entries and MT imports store 0) and the PREVIOUS one
 * needs a P/L, otherwise the pair tells us nothing.
 */
function riskDrift(rows: Row[]): RiskDrift {
  let winCount = 0;
  let winRisk = 0;
  let lossCount = 0;
  let lossRisk = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (cur.riskAmount === null || cur.riskAmount <= 0) continue;
    if (prev.pnl === null || prev.pnl === 0) continue; // break-even decides nothing
    if (prev.pnl > 0) {
      winCount += 1;
      winRisk += cur.riskAmount;
    } else {
      lossCount += 1;
      lossRisk += cur.riskAmount;
    }
  }

  const afterWin = winCount > 0 ? { count: winCount, avgRisk: winRisk / winCount } : null;
  const afterLoss =
    lossCount > 0 ? { count: lossCount, avgRisk: lossRisk / lossCount } : null;

  return {
    pairs: winCount + lossCount,
    afterWin,
    afterLoss,
    driftRatio:
      afterWin && afterLoss && afterWin.avgRisk > 0
        ? afterLoss.avgRisk / afterWin.avgRisk - 1
        : null,
  };
}

export async function getAttributionStats(
  userId: string,
): Promise<AttributionStats> {
  const [trades, totalTrades, account] = await Promise.all([
    db.tradeJournal.findMany({
      where: { userId, status: "CLOSED" },
      select: {
        direction: true,
        pnl: true,
        rMultiple: true,
        exitPrice: true,
        stopLoss: true,
        takeProfit: true,
        riskAmount: true,
        emotion: true,
        mistakes: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
      // Risk drift reads this order; every other cut is order-independent.
      orderBy: { openedAt: "asc" },
    }),
    db.tradeJournal.count({ where: { userId } }),
    db.tradingAccount.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { currency: true },
    }),
  ]);

  const rows: Row[] = trades.map((t) => ({
    direction: t.direction,
    pnl: decToNum(t.pnl),
    rMultiple: decToNum(t.rMultiple),
    exitPrice: decToNum(t.exitPrice),
    stopLoss: decToNum(t.stopLoss),
    takeProfit: decToNum(t.takeProfit),
    riskAmount: decToNum(t.riskAmount),
    tags: t.tags.map((j) => j.tag.name),
    emotion: t.emotion,
    mistakes: t.mistakes,
  }));

  const withStop = newAcc("Có ghi SL");
  const withoutStop = newAcc("Không ghi SL");
  for (const r of rows) push(hasStop(r) ? withStop : withoutStop, r);

  return {
    currency: account?.currency ?? "USD",
    totalTrades,
    closedTrades: rows.length,
    byTag: breakdown(rows, (r) => r.tags, byFrequency),
    byEmotion: breakdown(rows, (r) => (r.emotion ? [r.emotion] : []), byFrequency),
    byMistake: breakdown(rows, (r) => (r.mistakes ? [r.mistakes] : []), byCost),
    stopDiscipline: {
      withStop: finalize(withStop),
      withoutStop: finalize(withoutStop),
    },
    exitClassification: exitClassification(rows),
    riskDrift: riskDrift(rows),
  };
}
