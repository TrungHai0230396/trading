/**
 * GET /api/dashboard
 *
 * One aggregate read for the Tổng quan page: today's P/L, open-trade
 * count, 30-day win rate / avg R, cumulative equity series, and the top
 * consensus picks from the user's latest scanner run.
 *
 * Bitget balance/positions are NOT in here on purpose — that's an
 * external API call with its own latency/failure modes; the client
 * fetches /api/brokers/bitget/account separately so a slow exchange
 * can't hold up the local stats.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Start of "today" in Vietnam time (UTC+7), expressed in UTC. */
function vnDayStartUtc(now = new Date()): Date {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  vn.setUTCHours(0, 0, 0, 0);
  return new Date(vn.getTime() - 7 * 3600_000);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const todayStart = vnDayStartUtc(now);
  const d30 = new Date(now.getTime() - 30 * 86400_000);

  const [openCount, closedAll, latestRun, account] = await Promise.all([
    db.tradeJournal.count({ where: { userId, status: "OPEN" } }),
    // All closed trades once — equity series, today P/L and 30d stats all
    // derive from this single read (typical volume: tens to hundreds).
    db.tradeJournal.findMany({
      where: { userId, status: "CLOSED", closedAt: { not: null } },
      select: { pnl: true, rMultiple: true, closedAt: true, symbol: true },
      orderBy: { closedAt: "asc" },
      take: 1000,
    }),
    db.analysisRun.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, market: true },
    }),
    db.tradingAccount.findFirst({
      where: { userId },
      select: { currency: true },
    }),
  ]);

  // Equity series + windowed stats in one pass.
  let equity = 0;
  const series: Array<{ t: string; equity: number }> = [];
  let todayPnl = 0;
  let wins30 = 0;
  let closed30 = 0;
  let rSum30 = 0;
  let rCount30 = 0;
  for (const t of closedAll) {
    const pnl = t.pnl !== null ? Number(t.pnl) : 0;
    equity += pnl;
    series.push({ t: t.closedAt!.toISOString(), equity: Number(equity.toFixed(2)) });
    if (t.closedAt! >= todayStart) todayPnl += pnl;
    if (t.closedAt! >= d30) {
      closed30 += 1;
      if (pnl > 0) wins30 += 1;
      if (t.rMultiple !== null) {
        rSum30 += Number(t.rMultiple);
        rCount30 += 1;
      }
    }
  }

  // Top consensus picks from the newest run (if it stored any).
  let scannerTop: Array<{ symbol: string; signal: string; score: number | null }> = [];
  if (latestRun) {
    const rows = await db.analysisResult.findMany({
      where: { runId: latestRun.id, timeframe: "CONSENSUS" },
      orderBy: { score: "desc" },
      take: 5,
      select: { symbol: true, signal: true, score: true },
    });
    scannerTop = rows.map((r) => ({
      symbol: r.symbol,
      signal: r.signal,
      score: r.score,
    }));
  }

  return NextResponse.json({
    currency: account?.currency ?? "USD",
    stats: {
      todayPnl: Number(todayPnl.toFixed(2)),
      openCount,
      closed30,
      winRate30: closed30 > 0 ? wins30 / closed30 : null,
      avgR30: rCount30 > 0 ? Number((rSum30 / rCount30).toFixed(2)) : null,
    },
    equitySeries: series.slice(-200),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          createdAt: latestRun.createdAt.toISOString(),
          market: latestRun.market,
          top: scannerTop,
        }
      : null,
  });
}
