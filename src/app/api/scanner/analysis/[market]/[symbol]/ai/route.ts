/**
 * POST /api/scanner/analysis/[market]/[symbol]/ai
 *
 * Runs the AI narrative on demand. The analysis page no longer auto-
 * runs Gemini on mount — user clicks the button, this endpoint fires.
 * Benefits:
 *   - Saves Gemini quota on coins users only glance at
 *   - 503 errors don't break page load
 *   - Faster TTFB on the analysis page
 *
 * Body: none (params drive everything).
 * Response: TradeAnalysis JSON or { error: string }.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildAnalysisSnapshot } from "@/lib/analysis/snapshot";
import { runSymbolAnalysis } from "@/lib/ai/symbol-analysis";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ market: string; symbol: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { market: rawMarket, symbol: rawSymbol } = await ctx.params;
  const market = rawMarket.toUpperCase();
  if (market !== "CRYPTO" && market !== "FOREX") {
    return NextResponse.json({ error: "Market không hợp lệ" }, { status: 400 });
  }
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3) {
    return NextResponse.json({ error: "Symbol không hợp lệ" }, { status: 400 });
  }

  try {
    // Build a fresh snapshot — can't rely on the page-side React cache
    // because this endpoint runs in a different request scope.
    const snapshot = await buildAnalysisSnapshot({
      userId: session.user.id,
      market: market as "CRYPTO" | "FOREX",
      symbol,
    });
    const analysis = await runSymbolAnalysis(snapshot);
    return NextResponse.json(analysis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
