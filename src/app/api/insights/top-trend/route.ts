import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTopTrendSummary } from "@/lib/scanner/runner";
import type { Timeframe } from "@/lib/scanner/candles";

/**
 * GET /api/insights/top-trend?market=CRYPTO
 *
 * Returns the strongest trends from the top 100 USDT universe, split
 * into bullish (highest score) and bearish (lowest score). Unlike the
 * scanner's `consensusTop`, this does NOT require unanimous TF
 * agreement — a 3-of-4 TF lean still shows up. The page uses this to
 * surface "coin đang trend mạnh" suggestions the user can click to
 * auto-analyze with AI.
 *
 * Powered by the same EMA-WMA-on-RSI logic the scanner uses across
 * 1h / 4h / 1d / 1w. Top 100 × 4 TFs is heavy — caller should expect
 * 30-60s response time. NDJSON streaming is not used here because the
 * UI just shows a skeleton; if it becomes painful we can switch.
 */

const querySchema = z.object({
  market: z.enum(["FOREX", "CRYPTO"]),
});

const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d", "1w"];
const TOP_N = 10;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    market: (url.searchParams.get("market") ?? "").toUpperCase(),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Query không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const sorted = await getTopTrendSummary({
      market: parsed.data.market,
      timeframes: TIMEFRAMES,
    });

    // Strip per-TF detail before sending — the page only needs symbol
    // + score + signal counts to render the trend chip.
    const stripped = sorted.map((s) => ({
      symbol: s.symbol,
      score: s.score,
      alignment: s.alignment,
      bullishCount: s.bullishCount,
      bearishCount: s.bearishCount,
      neutralCount: s.neutralCount,
    }));

    const bullish = stripped.slice(0, TOP_N);
    const bearish = stripped.slice(-TOP_N).reverse();

    return NextResponse.json({
      market: parsed.data.market,
      timeframes: TIMEFRAMES,
      bullish,
      bearish,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
