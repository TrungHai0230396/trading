/**
 * Match recent NewsArticle rows against a single instrument.
 *
 *   1. If the article's `tags` JSON contains the base ticker (eg "BTC"
 *      for BTCUSDT, "EUR" for EURUSD), it matches.
 *   2. Otherwise we fall back to a case-insensitive title `contains`
 *      check on the same base ticker.
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
  const titleNeedle = tickerUpper;

  const matched: RelatedNewsItem[] = [];
  for (const row of candidates) {
    let hit = false;
    if (Array.isArray(row.tags)) {
      for (const t of row.tags as unknown[]) {
        if (typeof t === "string" && t.toUpperCase() === tickerUpper) {
          hit = true;
          break;
        }
      }
    }
    if (!hit && row.title) {
      // Word-ish match: avoid "BTC" matching "BTCUSDT" inside random text.
      // Simple but adequate: uppercased title contains the ticker.
      if (row.title.toUpperCase().includes(titleNeedle)) hit = true;
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
