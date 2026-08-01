/**
 * GET /api/journal/live-quotes
 *
 * Batch live prices for all the user's OPEN journal trades in one call —
 * the journal list polls this every ~30s to show current price, unrealized
 * PnL and %-progress toward SL/TP without leaving the app.
 *
 * Crypto prices come from Binance's public ticker (no key). Forex uses
 * TwelveData when a key is configured; symbols that fail are simply
 * omitted — the UI shows "—" rather than an error. Unrealized PnL is null
 * (not 0) for instruments the app cannot value in USD.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPrice, type Market } from "@/lib/quotes";
import { derivePnl } from "@/lib/journal/derive";
import { rateLimit } from "@/lib/brokers/rate-limit";

export const runtime = "nodejs";

type LiveQuote = {
  tradeId: string;
  symbol: string;
  price: number;
  /** USD. Null when the app cannot value the position in USD — see derivePnl. */
  unrealizedPnl: number | null;
  /** 0..1 progress from entry toward SL (1 = at SL). Null without SL. */
  slProgress: number | null;
  /** 0..1 progress from entry toward TP (1 = at TP). Null without TP. */
  tpProgress: number | null;
  fetchedAt: string;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // Normal client polls ~every 30s (2/min). Cap well above that so real use
  // never trips, but a scripted loop fanning out to Binance/TwelveData does.
  if (!rateLimit(`live-quotes:${session.user.id}`, 12, 60_000)) {
    return NextResponse.json({ quotes: [] }, { status: 429 });
  }

  const open = await db.tradeJournal.findMany({
    where: {
      userId: session.user.id,
      status: "OPEN",
      market: { in: ["CRYPTO", "FOREX"] },
    },
    select: {
      id: true,
      symbol: true,
      market: true,
      direction: true,
      entryPrice: true,
      stopLoss: true,
      takeProfit: true,
      lotSize: true,
    },
    take: 30,
  });
  if (open.length === 0) {
    return NextResponse.json({ quotes: [] });
  }

  // One price fetch per unique (market, symbol) — several journal entries
  // on the same symbol share it.
  const uniqueKeys = new Map<string, { market: Market; symbol: string }>();
  for (const t of open) {
    const key = `${t.market}:${t.symbol}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.set(key, { market: t.market as Market, symbol: t.symbol });
    }
  }

  const prices = new Map<string, number>();
  await Promise.all(
    [...uniqueKeys.entries()].map(async ([key, q]) => {
      try {
        const quote = await getPrice(q.market, q.symbol);
        if (Number.isFinite(quote.price) && quote.price > 0) {
          prices.set(key, quote.price);
        }
      } catch {
        // omit — UI renders "—"
      }
    }),
  );

  const now = new Date().toISOString();
  const quotes: LiveQuote[] = [];
  for (const t of open) {
    const price = prices.get(`${t.market}:${t.symbol}`);
    if (price === undefined) continue;

    const entry = Number(t.entryPrice);
    const sl = t.stopLoss !== null ? Number(t.stopLoss) : null;
    const tp = t.takeProfit !== null ? Number(t.takeProfit) : null;
    const lot = Number(t.lotSize);

    // Reuse the app's own PnL math (per-instrument contract sizes) by treating
    // the live price as a hypothetical exit. Null when it cannot be valued in
    // USD — emit the null so the UI shows "—" instead of a made-up figure.
    const unrealizedPnl = derivePnl({
      market: t.market,
      symbol: t.symbol,
      direction: t.direction,
      entryPrice: entry,
      exitPrice: price,
      lotSize: lot,
    });

    const progress = (target: number | null): number | null => {
      if (target === null || !Number.isFinite(entry) || entry === target)
        return null;
      // Signed progress from entry toward target; clamp to [0, 1.5] so a
      // blow-through past SL/TP still renders sensibly.
      const p = (price - entry) / (target - entry);
      return Math.max(0, Math.min(1.5, p));
    };

    quotes.push({
      tradeId: t.id,
      symbol: t.symbol,
      price,
      unrealizedPnl,
      slProgress: progress(sl),
      tpProgress: progress(tp),
      fetchedAt: now,
    });
  }

  return NextResponse.json({ quotes });
}
