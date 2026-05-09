/**
 * News service — orchestrates CryptoPanic fetch + Gemini summarization
 * + persistence into NewsArticle.
 */

import { db } from "@/lib/db";
import {
  fetchCryptoPanicNews,
  type CryptoPanicArticle,
  type CryptoPanicFilter,
} from "@/lib/news/cryptopanic";
import { fetchRssNews, type RssArticle } from "@/lib/news/rss";
import { summarizeBatch, type SummarizeInput } from "@/lib/ai/gemini";
import type { NewsArticle, Prisma } from "@/generated/prisma";

/** Unified shape that both source fetchers conform to. */
type RawArticle = {
  externalId: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  currencies?: string[];
};

/**
 * Pick the configured news source. CryptoPanic if a key is set; otherwise
 * fall back to public RSS feeds — Gemini summarization still happens.
 */
async function fetchSourceArticles(
  filter: CryptoPanicFilter | undefined,
): Promise<{ articles: RawArticle[]; usedSource: "cryptopanic" | "rss" }> {
  if (process.env.CRYPTOPANIC_API_KEY) {
    const cp: CryptoPanicArticle[] = await fetchCryptoPanicNews(
      filter ?? "hot",
    );
    return { articles: cp, usedSource: "cryptopanic" };
  }
  const rss: RssArticle[] = await fetchRssNews();
  return { articles: rss, usedSource: "rss" };
}

export type RefreshError = {
  externalId: string;
  title: string;
  message: string;
};

export type RefreshSummary = {
  inserted: number;
  skipped: number;
  fetched: number;
  errors: RefreshError[];
};

export type NewsItem = {
  id: string;
  externalId: string | null;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string | null;
  sentiment: string | null;
  impact: string | null;
  tags: string[];
  aiModel: string | null;
  createdAt: string;
};

export type ListNewsParams = {
  userId: string;
  sentiment?: string | null;
  impact?: string | null;
  source?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
};

export type ListNewsResult = {
  items: NewsItem[];
  nextCursor: string | null;
};

/**
 * Refresh news for a user:
 * 1. fetch from CryptoPanic
 * 2. dedupe by externalId
 * 3. summarize new items via Gemini (concurrency 3)
 * 4. upsert into NewsArticle
 */
export async function refreshNewsForUser(
  userId: string,
  options: { filter?: CryptoPanicFilter } = {},
): Promise<RefreshSummary> {
  const { articles: fetched } = await fetchSourceArticles(options.filter);
  const errors: RefreshError[] = [];

  if (fetched.length === 0) {
    return { inserted: 0, skipped: 0, fetched: 0, errors };
  }

  const externalIds = fetched.map((a) => a.externalId);
  const existing = await db.newsArticle.findMany({
    where: { externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const existingSet = new Set(
    existing.map((e) => e.externalId).filter((x): x is string => Boolean(x)),
  );

  const newOnes = fetched.filter((a) => !existingSet.has(a.externalId));
  const skipped = fetched.length - newOnes.length;

  if (newOnes.length === 0) {
    return { inserted: 0, skipped, fetched: fetched.length, errors };
  }

  const inputs: (SummarizeInput & { article: RawArticle })[] = newOnes.map(
    (a) => ({
      article: a,
      title: a.title,
      source: a.source,
      url: a.url,
    }),
  );

  const outcomes = await summarizeBatch(inputs, {
    concurrency: 3,
    pauseMs: 200,
  });

  let inserted = 0;
  for (const outcome of outcomes) {
    const article = outcome.input.article;
    try {
      const tags: Prisma.InputJsonValue = outcome.ok
        ? (outcome.result.tags as unknown as Prisma.InputJsonValue)
        : ((article.currencies ?? []) as unknown as Prisma.InputJsonValue);

      const data = {
        userId,
        source: article.source,
        externalId: article.externalId,
        title: article.title.slice(0, 512),
        url: article.url,
        publishedAt: article.publishedAt,
        summary: outcome.ok ? outcome.result.summary : null,
        sentiment: outcome.ok ? outcome.result.sentiment : null,
        impact: outcome.ok ? outcome.result.impact : null,
        tags,
        aiModel: outcome.ok ? outcome.result.aiModel : null,
      };

      await db.newsArticle.upsert({
        where: { externalId: article.externalId },
        update: data,
        create: data,
      });
      inserted += 1;

      if (!outcome.ok) {
        errors.push({
          externalId: article.externalId,
          title: article.title,
          message: outcome.error,
        });
      }
    } catch (err) {
      errors.push({
        externalId: article.externalId,
        title: article.title,
        message:
          err instanceof Error ? err.message : "Lỗi lưu DB không xác định",
      });
    }
  }

  return { inserted, skipped, fetched: fetched.length, errors };
}

function rowToItem(row: NewsArticle): NewsItem {
  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = (row.tags as unknown as unknown[])
      .map((t) => (typeof t === "string" ? t : String(t)))
      .filter((t) => t.length > 0);
  }
  return {
    id: row.id,
    externalId: row.externalId ?? null,
    source: row.source,
    title: row.title,
    url: row.url,
    publishedAt: row.publishedAt.toISOString(),
    summary: row.summary,
    sentiment: row.sentiment,
    impact: row.impact,
    tags,
    aiModel: row.aiModel,
    createdAt: row.createdAt.toISOString(),
  };
}

const ALLOWED_SENTIMENT = new Set(["bullish", "bearish", "neutral"]);
const ALLOWED_IMPACT = new Set(["high", "medium", "low"]);

/**
 * List news with cursor-based pagination (cursor = NewsArticle.id), filtered by
 * the optional sentiment / impact / source / search params.
 */
export async function listNews(
  params: ListNewsParams,
): Promise<ListNewsResult> {
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);

  const where: Prisma.NewsArticleWhereInput = {
    userId: params.userId,
  };
  if (params.sentiment && ALLOWED_SENTIMENT.has(params.sentiment)) {
    where.sentiment = params.sentiment;
  }
  if (params.impact && ALLOWED_IMPACT.has(params.impact)) {
    where.impact = params.impact;
  }
  if (params.source && params.source.trim().length > 0) {
    where.source = params.source;
  }
  if (params.q && params.q.trim().length > 0) {
    const q = params.q.trim();
    where.OR = [
      { title: { contains: q } },
      { summary: { contains: q } },
    ];
  }

  const rows = await db.newsArticle.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor
      ? { cursor: { id: params.cursor }, skip: 1 }
      : {}),
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? slice[slice.length - 1]!.id : null;

  return {
    items: slice.map(rowToItem),
    nextCursor,
  };
}

/** Distinct source list for filter dropdowns. */
export async function listNewsSources(userId: string): Promise<string[]> {
  const rows = await db.newsArticle.findMany({
    where: { userId },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
    take: 100,
  });
  return rows.map((r) => r.source);
}
