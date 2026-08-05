import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const userId = session.user.id;

  const [openCount, closedTrades] = await Promise.all([
    db.tradeJournal.count({ where: { userId, status: "OPEN" } }),
    db.tradeJournal.findMany({
      where: { userId, status: "CLOSED" },
      select: { pnl: true, rMultiple: true },
    }),
  ]);

  const closedTotal = closedTrades.length;
  let wins = 0;
  // Win-rate denominator counts only trades whose outcome we actually KNOW.
  // A closed trade with no P&L is unknown, not a loss — and auto-close now
  // creates those in bulk (MEXC/OKX give us no exit figure, so the row waits
  // for the user to type the real one). Counting them as losses would quietly
  // drag every user's win-rate down.
  let scored = 0;
  let totalPnl = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of closedTrades) {
    const known = t.pnl !== null && t.pnl !== undefined;
    const pnl = known ? Number(t.pnl!.toString()) : 0;
    totalPnl += pnl;
    if (known) {
      scored += 1;
      if (pnl > 0) wins += 1;
    }
    if (t.rMultiple !== null && t.rMultiple !== undefined) {
      const r = Number(t.rMultiple.toString());
      if (Number.isFinite(r)) {
        rSum += r;
        rCount += 1;
      }
    }
  }

  const winRate = scored > 0 ? wins / scored : 0;
  const avgR = rCount > 0 ? Number((rSum / rCount).toFixed(4)) : 0;

  // Currency: use the user's first trading account currency, fallback USD.
  const account = await db.tradingAccount.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { currency: true },
  });

  return NextResponse.json({
    totalTrades: openCount + closedTotal,
    openTrades: openCount,
    closedTrades: closedTotal,
    // The win-rate denominator, shipped alongside closedTotal: the stat bar
    // used to caption the percentage with "N lệnh đã đóng" while computing it
    // over a smaller set, so a reader could back-compute a winner count that
    // never existed.
    scoredTrades: scored,
    winRate,
    avgR,
    totalPnl: Number(totalPnl.toFixed(4)),
    currency: account?.currency ?? "USD",
  });
}
