/**
 * Per-trading-system performance summary for the "Phân tích hệ thống" page.
 *
 * Groups the user's journal trades by their tradingSystem and computes, per
 * system: counts by status, win-rate / total P&L / avg R / profit factor over
 * CLOSED trades (real, user-entered numbers), plus checklist adherence — how
 * often the system's required checks were ticked, and whether following the
 * checklist actually changed the win-rate.
 */

import "server-only";
import { db } from "@/lib/db";

type Check = { label: string; required: boolean; checked: boolean };

export type SystemStat = {
  systemId: string | null; // null = "Chưa gắn hệ thống"
  name: string;
  archived: boolean;
  total: number;
  closed: number;
  open: number;
  pending: number;
  winRate: number; // over closed
  totalPnl: number;
  avgR: number;
  /** Σ wins / |Σ losses|; null when there are no losing trades. */
  profitFactor: number | null;
  bestPnl: number;
  worstPnl: number;
  // ── Checklist adherence (over CLOSED trades that carry a snapshot) ──
  checkedTrades: number;
  followed: number;
  adherenceRate: number; // followed / checkedTrades
  winRateFollowed: number | null;
  winRateNotFollowed: number | null;
};

function parseChecks(v: unknown): Check[] {
  if (!Array.isArray(v)) return [];
  const out: Check[] = [];
  for (const it of v) {
    if (it && typeof it === "object" && "checked" in it) {
      const o = it as Record<string, unknown>;
      out.push({
        label: String(o.label ?? ""),
        required: Boolean(o.required),
        checked: Boolean(o.checked),
      });
    }
  }
  return out;
}

/** Followed = every REQUIRED item ticked (if none required, every item ticked). */
function followedChecklist(checks: Check[]): boolean {
  const required = checks.filter((c) => c.required);
  if (required.length === 0) return checks.every((c) => c.checked);
  return required.every((c) => c.checked);
}

type Row = {
  status: string;
  pnl: number | null;
  rMultiple: number | null;
  checks: Check[];
};

function summarize(
  systemId: string | null,
  name: string,
  archived: boolean,
  rows: Row[],
): SystemStat {
  const closedRows = rows.filter((r) => r.status === "CLOSED");
  // Only trades with a KNOWN P&L belong in a win-rate. A closed trade with no
  // number yet is unknown, not a loss — auto-close creates those whenever the
  // exchange can't tell us the exit figure.
  const scoredRows = closedRows.filter((r) => r.pnl !== null);
  let wins = 0;
  let totalPnl = 0;
  let rSum = 0;
  let rCount = 0;
  let winSum = 0;
  let lossSum = 0; // magnitude of losses
  let best = 0;
  let worst = 0;
  for (const r of closedRows) {
    const pnl = r.pnl ?? 0;
    totalPnl += pnl;
    if (pnl > 0) {
      wins += 1;
      winSum += pnl;
    } else if (pnl < 0) {
      lossSum += -pnl;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;
    if (r.rMultiple !== null && Number.isFinite(r.rMultiple)) {
      rSum += r.rMultiple;
      rCount += 1;
    }
  }

  // Two different questions, so two different denominators.
  //
  // ADHERENCE — "how often did you follow your own checklist?" — has nothing to
  // do with money, so it counts every closed trade carrying a snapshot. Scoping
  // it to trades with a P&L would report 1/3 where the truth is 9/12, and hide
  // the block entirely for a user who ticks diligently but hasn't entered
  // results yet.
  const withChecks = closedRows.filter((r) => r.checks.length > 0);
  let followed = 0;
  let notFollowed = 0;
  for (const r of withChecks) {
    if (followedChecklist(r.checks)) followed += 1;
    else notFollowed += 1;
  }

  // WIN-RATE followed vs not — this one IS about money, so a trade with no P&L
  // entered yet must not land on the "not a win" side of either bucket.
  const scoredWithChecks = withChecks.filter((r) => r.pnl !== null);
  let followedScored = 0;
  let followedWins = 0;
  let notFollowedScored = 0;
  let notFollowedWins = 0;
  for (const r of scoredWithChecks) {
    const win = (r.pnl ?? 0) > 0;
    if (followedChecklist(r.checks)) {
      followedScored += 1;
      if (win) followedWins += 1;
    } else {
      notFollowedScored += 1;
      if (win) notFollowedWins += 1;
    }
  }

  return {
    systemId,
    name,
    archived,
    total: rows.length,
    closed: closedRows.length,
    open: rows.filter((r) => r.status === "OPEN").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    winRate: scoredRows.length > 0 ? wins / scoredRows.length : 0,
    totalPnl,
    avgR: rCount > 0 ? rSum / rCount : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : winSum > 0 ? null : 0,
    bestPnl: best,
    worstPnl: worst,
    checkedTrades: withChecks.length,
    followed,
    adherenceRate: withChecks.length > 0 ? followed / withChecks.length : 0,
    winRateFollowed:
      followedScored > 0 ? followedWins / followedScored : null,
    winRateNotFollowed:
      notFollowedScored > 0 ? notFollowedWins / notFollowedScored : null,
  };
}

export async function getSystemStats(
  userId: string,
): Promise<{ currency: string; systems: SystemStat[] }> {
  const [systems, trades, account] = await Promise.all([
    db.tradingSystem.findMany({
      where: { userId },
      select: { id: true, name: true, archived: true },
      orderBy: { createdAt: "asc" },
    }),
    db.tradeJournal.findMany({
      where: { userId },
      select: {
        tradingSystemId: true,
        status: true,
        pnl: true,
        rMultiple: true,
        systemChecks: true,
      },
    }),
    db.tradingAccount.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { currency: true },
    }),
  ]);

  const nameById = new Map(systems.map((s) => [s.id, s.name]));
  const archivedById = new Map(systems.map((s) => [s.id, s.archived]));

  const NONE = "__none__";
  const buckets = new Map<string, Row[]>();
  for (const t of trades) {
    const key = t.tradingSystemId ?? NONE;
    const row: Row = {
      status: t.status,
      pnl: t.pnl !== null ? Number(t.pnl.toString()) : null,
      rMultiple: t.rMultiple !== null ? Number(t.rMultiple.toString()) : null,
      checks: parseChecks(t.systemChecks),
    };
    const arr = buckets.get(key);
    if (arr) arr.push(row);
    else buckets.set(key, [row]);
  }

  const result: SystemStat[] = [];
  for (const [key, rows] of buckets) {
    if (key === NONE) {
      result.push(summarize(null, "Chưa gắn hệ thống", false, rows));
    } else {
      result.push(
        summarize(
          key,
          nameById.get(key) ?? "Hệ thống đã xoá",
          archivedById.get(key) ?? false,
          rows,
        ),
      );
    }
  }

  // Most-traded first; the "no system" bucket sinks to the bottom.
  result.sort((a, b) => {
    if (a.systemId === null) return 1;
    if (b.systemId === null) return -1;
    return b.total - a.total;
  });

  return { currency: account?.currency ?? "USD", systems: result };
}
