import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const run = await db.analysisRun.findFirst({
    where: { id, userId: session.user.id },
    include: {
      results: {
        orderBy: [{ symbol: "asc" }, { timeframe: "asc" }],
      },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Không tìm thấy phiên quét" }, { status: 404 });
  }

  return NextResponse.json({
    id: run.id,
    name: run.name,
    market: run.market,
    symbols: run.symbols,
    timeframes: run.timeframes,
    indicators: run.indicators,
    config: run.config,
    createdAt: run.createdAt,
    results: run.results,
  });
}
