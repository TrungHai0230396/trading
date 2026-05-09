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
  let totalPnl = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of closedTrades) {
    const pnl = t.pnl ? Number(t.pnl.toString()) : 0;
    totalPnl += pnl;
    if (pnl > 0) wins += 1;
    if (t.rMultiple !== null && t.rMultiple !== undefined) {
      const r = Number(t.rMultiple.toString());
      if (Number.isFinite(r)) {
        rSum += r;
        rCount += 1;
      }
    }
  }

  const winRate = closedTotal > 0 ? wins / closedTotal : 0;
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
    winRate,
    avgR,
    totalPnl: Number(totalPnl.toFixed(4)),
    currency: account?.currency ?? "USD",
  });
}
