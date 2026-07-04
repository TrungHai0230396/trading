/**
 * Match recent NewsArticle rows against a single instrument.
 *
 *   1. If the article's `tags` JSON contains the base ticker (eg "BTC"
 *      for BTCUSDT, "EUR" for EURUSD), it matches. High precision.
 *   2. Otherwise fall back to a TITLE regex that requires a
 *      crypto-context marker around the ticker. Plain substring is too
 *      noisy — eg "ACT" is also a common English word for legislation,
 *      so titles like "Clarity Act" / "Take It Down Act" / "ACTivation
 *      Window" would all false-match. Required patterns:
 *        - `$ACT` (dollar prefix)
 *        - `ACT/USDT`, `ACTUSDT`, `ACT-PERP`
 *        - `ACT token`, `ACT coin`, `ACT crypto`, `ACT price`, `ACT chain`
 *
 * If no NewsArticle rows exist for this user yet (the user hasn't
 * refreshed `/news`), we simply return [] — Gemini will analyze the
 * price snapshot alone.
 */

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { InsightMarket } from "@/lib/insights/curated";
import { findForexPair } from "@/lib/calc/forex-pairs";
import { parseCryptoSymbol } from "@/lib/calc/crypto-symbols";

export type RelatedNewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string | null;
  sentiment: string | null;
  publishedAt: string;
};

/** Extract the "base ticker" used to match a news article. */
export function baseTicker(market: InsightMarket, symbol: string): string {
  if (market === "FOREX") {
    const pair = findForexPair(symbol);
    return (pair?.base ?? symbol.slice(0, 3)).toUpperCase();
  }
  const parsed = parseCryptoSymbol(symbol);
  return (parsed.base || symbol).toUpperCase();
}

export async function getRelatedNews(opts: {
  userId: string;
  symbol: string;
  market: InsightMarket;
  limit?: number;
}): Promise<RelatedNewsItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const ticker = baseTicker(opts.market, opts.symbol);

  // Read a generous candidate window — last ~150 articles for this user
  // — and filter in Node. Doing the JSON-array filter via Prisma is
  // brittle across MySQL versions, and this set is tiny.
  const candidates = await db.newsArticle.findMany({
    where: { userId: opts.userId } as Prisma.NewsArticleWhereInput,
    orderBy: { publishedAt: "desc" },
    take: 150,
    select: {
      id: true,
      title: true,
      source: true,
      url: true,
      summary: true,
      sentiment: true,
      tags: true,
      publishedAt: true,
    },
  });

  const tickerUpper = ticker.toUpperCase();
  // Escape for regex (tickers are A-Z0-9 in practice, but safe to be paranoid).
  const t = tickerUpper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Title patterns that strongly signal "this article is about TICKER":
  //   $ACT      — dollar-prefixed mention (de facto crypto convention)
  //   ACT/USDT  — explicit trading pair
  //   ACTUSDT   — Binance/Bitget-style symbol
  //   ACT-PERP  — perp suffix
  //   ACT token / ACT coin / ACT crypto / ACT price / ACT chain / ACT protocol
  //                — ticker followed by a crypto-context noun
  const titleRegex = new RegExp(
    `(\\$${t}\\b)|(\\b${t}/[A-Z]{2,5}\\b)|(\\b${t}USD[TC]?\\b)|(\\b${t}-PERP\\b)|(\\b${t}\\s+(token|coin|crypto|price|chain|protocol|network|blockchain)\\b)`,
    "i",
  );

  const matched: RelatedNewsItem[] = [];
  for (const row of candidates) {
    let hit = false;
    if (Array.isArray(row.tags)) {
      for (const tag of row.tags as unknown[]) {
        if (typeof tag === "string" && tag.toUpperCase() === tickerUpper) {
          hit = true;
          break;
        }
      }
    }
    if (!hit && row.title) {
      if (titleRegex.test(row.title)) hit = true;
    }
    if (hit) {
      matched.push({
        id: row.id,
        title: row.title,
        source: row.source,
        url: row.url,
        summary: row.summary ?? null,
        sentiment: row.sentiment ?? null,
        publishedAt: row.publishedAt.toISOString(),
      });
      if (matched.length >= limit) break;
    }
  }

  return matched;
}
